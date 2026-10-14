import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { hash, canonical, loadBatch } from '../ui-library/library.js';
import { summarize } from '../ui-library/catalog.js';

export function identity(...parts)
{
    const hex = hash(parts).slice(0, 32).split('');
    hex[12] = '5';
    hex[16] = '8';
    const text = hex.join('');
    return `${text.slice(0,8)}-${text.slice(8,12)}-${text.slice(12,16)}-${text.slice(16,20)}-${text.slice(20)}`;
}

export function createAssetPool()
{
    const connectionString = process.env.ASSET_DATABASE_URL;
    if (!connectionString)
    {
        throw new Error('ASSET_DATABASE_URL is required; Track credentials are never used.');
    }
    const url = new URL(connectionString);
    if (decodeURIComponent(url.pathname.slice(1)) !== 'gameai_asset_library')
    {
        throw new Error('Dedicated gameai_asset_library database required.');
    }
    return new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
}

export async function migrate(pool)
{
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(70928150)');
        const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
        const checksum = hash(sql);
        await client.query('CREATE SCHEMA IF NOT EXISTS ingestion');
        await client.query('CREATE TABLE IF NOT EXISTS ingestion.schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
        const { rows: [prior] } = await client.query('SELECT checksum FROM ingestion.schema_migrations WHERE version=1');
        if (prior && prior.checksum !== checksum)
        {
            throw new Error('Applied migration changed; add a new migration instead of rewriting schema v1.');
        }
        if (!prior)
        {
            await client.query(sql);
            await client.query('INSERT INTO ingestion.schema_migrations(version,checksum) VALUES(1,$1)', [checksum]);
        }
        await client.query('COMMIT');
        return { success: true, schema: 'asset-library/1' };
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        throw error;
    }
    finally
    {
        client.release();
    }
}

export function selectClosure(batch, rootGuid)
{
    const byGuid = new Map(batch.entries.map(entry => [entry.guid, entry]));
    if (!byGuid.has(rootGuid))
    {
        throw new Error('Requested root GUID is not in the validated package.');
    }
    const selected = new Set();
    function visit(guid)
    {
        if (selected.has(guid))
        {
            return;
        }
        const entry = byGuid.get(guid);
        if (!entry)
        {
            throw new Error('Missing prefab dependency.');
        }
        selected.add(guid);
        Object.values(entry.document.resources).forEach(reference => visit(reference.id));
    }
    visit(rootGuid);
    return batch.entries.filter(entry => selected.has(entry.guid));
}

export function convertEntry(entry, templateId, dependencies, resources)
{
    // Version 2 retains the exact v1 layout as evidence; no visual capability is invented.
    const bindings = [...(entry.visual?.bindings ?? []), ...(entry.visual?.components ?? [])];
    const nodes = new Map(entry.document.prefab.nodes.map(node => [node.id, node]));
    for (const binding of entry.visual?.bindings ?? [])
    {
        if (!nodes.get(binding.nodeId)?.components.some(component => component.id === binding.componentId)
            && !entry.visual?.components.some(component => component.nodeId === binding.nodeId && component.componentId === binding.componentId))
        {
            // Native effects can be recorded as evidence but cannot be mistaken for a supported layout component.
            throw new Error(`Visual binding targets missing component: ${binding.nodeId}/${binding.componentId}`);
        }
        if (typeof binding.fileId !== 'string')
        {
            throw new Error('Source local file IDs must be strings.');
        }
    }
    return {
        schemaVersion: 'ui-template/2',
        metadata: { templateId, name: entry.document.prefab.name, sourceGuid: entry.guid, sourceRevision: entry.sourceRevision },
        references: {
            prefabs: dependencies.map(([refId, templateVersionId]) => ({ refId, templateVersionId })),
            resources: resources.map(([refId, resourceVersionId]) => ({ refId, resourceVersionId })),
        },
        hierarchy: structuredClone(entry.document.prefab),
        bindings: bindings.map(binding => ({ ...binding, refId: binding.resourceId })),
        environment: entry.metadata,
        diagnostics: entry.diagnostics,
        visualProfile: { status: 'not_analyzed', evidence: 'source-resources', observations: null },
    };
}

export async function upload(pool, directory, rootGuid)
{
    const batch = await loadBatch(directory);
    const entries = selectClosure(batch, rootGuid);
    const sourceId = identity('source', batch.sourceKey);
    const batchId = identity('batch', sourceId, batch.batchHash, rootGuid);
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(70928151)');
        await client.query('INSERT INTO catalog.sources VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [sourceId, batch.sourceKey, { adapter: 'offline-v1-to-library-v2/1', usageRights: 'unknown' }]);
        const prior = await client.query('SELECT result FROM ingestion.import_batches WHERE id=$1', [batchId]);
        if (prior.rows.length)
        {
            await client.query('COMMIT');
            return { ...prior.rows[0].result, repeated: true };
        }
        const allResources = new Map(entries.flatMap(entry => entry.visuals.map(resource => [resource.id, resource])));
        // A graph hash pins recursive dependencies, including legal cycles, without recursive version hashing.
        const graphHash = hash([...allResources].sort(([a], [b]) => a.localeCompare(b)));
        const resourceVersions = new Map();
        for (const resource of allResources.values())
        {
            const resourceId = identity('resource', sourceId, resource.id);
            const digest = hash({ resource, graphHash });
            const versionId = identity('resource-version', resourceId, digest);
            resourceVersions.set(resource.id, versionId);
            if (resource.blob)
            {
                const bytes = batch.blobs.get(resource.blob.sha256);
                if (!bytes || createHash('sha256').update(bytes).digest('hex') !== resource.blob.sha256)
                {
                    throw new Error('Binary integrity failure.');
                }
                await client.query('INSERT INTO assets.blobs VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [resource.blob.sha256, bytes, bytes.length]);
            }
            await client.query('INSERT INTO assets.resources VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [resourceId, sourceId, resource.id, resource.kind]);
            await client.query('INSERT INTO assets.resource_versions VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
                [versionId, resourceId, digest, resource, resource.blob?.sha256 ?? null]);
        }
        for (const resource of allResources.values())
        {
            for (const dependency of resource.dependencies)
            {
                await client.query('INSERT INTO assets.resource_dependencies VALUES($1,$2) ON CONFLICT DO NOTHING', [resourceVersions.get(resource.id), resourceVersions.get(dependency)]);
            }
        }
        const versions = new Map();
        const imported = [];
        for (const entry of entries)
        {
            const templateId = identity('template', sourceId, entry.guid);
            const dependencies = Object.entries(entry.document.resources).map(([alias, ref]) => [alias, versions.get(ref.id)]);
            const resources = entry.visuals.map(resource => [resource.id, resourceVersions.get(resource.id)]);
            const document = convertEntry(entry, templateId, dependencies, resources);
            const digest = hash(document);
            const versionId = identity('template-version', templateId, digest);
            versions.set(entry.guid, versionId);
            await client.query('INSERT INTO catalog.templates VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [templateId, sourceId, entry.guid, entry.document.prefab.name, entry.assetPath]);
            const quality = { extraction: entry.grade, layoutRebuild: 'not_tested', visualRebuild: 'not_tested', humanReview: 'pending' };
            await client.query('INSERT INTO catalog.template_versions(id,template_id,content_hash,document,source_snapshot,visual_evidence,quality,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
                [versionId, templateId, digest, document, entry.document, entry.visual, quality, { ...entry.metadata, assetPath: entry.assetPath, sourceRevision: entry.sourceRevision }]);
            for (const [alias, dependencyId] of dependencies)
            {
                await client.query('INSERT INTO catalog.template_dependencies VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [versionId, alias, dependencyId]);
            }
            for (const [refId, resourceVersionId] of resources)
            {
                await client.query('INSERT INTO catalog.template_resources VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [versionId, refId, resourceVersionId]);
            }
            for (const [ordinal, binding] of document.bindings.entries())
            {
                await client.query('INSERT INTO catalog.template_bindings VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [versionId, ordinal, binding]);
            }
            const summary = summarize({ name: entry.document.prefab.name, asset_path: entry.assetPath, document: entry.document, visual_resources: entry.visuals, diagnostics: entry.diagnostics, has_visual: Boolean(entry.visual), grade: entry.grade });
            const text = `${summary.category === 'login' ? '登录界面 login window. ' : ''}${entry.document.prefab.name}. ${entry.assetPath}. ${canonical(summary)}`;
            await client.query('INSERT INTO search.documents VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [versionId, text, hash(text), summary]);
            await client.query('INSERT INTO search.index_jobs(version_id,profile_id) SELECT $1,id FROM search.embedding_profiles ON CONFLICT DO NOTHING', [versionId]);
            imported.push({ versionId, templateId, name: entry.document.prefab.name, root: entry.guid === rootGuid, nodes: entry.document.prefab.nodes.length, resources: resources.length, quality });
        }
        const result = { success: true, batchId, repeated: false, source: batch.sourceKey, versions: imported, resourceVersions: resourceVersions.size };
        await client.query('INSERT INTO ingestion.import_batches(id,source_id,batch_hash,root_guid,result) VALUES($1,$2,$3,$4,$5)', [batchId, sourceId, batch.batchHash, rootGuid, result]);
        await client.query('COMMIT');
        return result;
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        throw error;
    }
    finally
    {
        client.release();
    }
}
