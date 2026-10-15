import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export function canonical(value)
{
    if (Array.isArray(value))
    {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (value !== null && typeof value === 'object')
    {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function hash(value)
{
    return createHash('sha256').update(canonical(value)).digest('hex');
}

function requireValue(condition, message)
{
    if (!condition)
    {
        throw new Error(message);
    }
}

function record(value)
{
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateDocument(document)
{
    requireValue(record(document) && document.schemaVersion === 'ui-template/1', 'Unsupported schemaVersion');
    requireValue(Object.keys(document).every(key => ['schemaVersion', 'resources', 'prefab'].includes(key)), 'Unknown document field');
    requireValue(record(document.resources) && record(document.prefab), 'resources and prefab are required');
    requireValue(typeof document.prefab.name === 'string' && document.prefab.name.trim(), 'Missing prefab name');
    const nodes = document.prefab.nodes;
    requireValue(Array.isArray(nodes) && nodes.length > 0 && nodes.length <= 100000, 'Invalid nodes');
    const ids = new Map();
    const positions = new Set();
    for (const node of nodes)
    {
        requireValue(typeof node.id === 'string' && node.id.length > 0 && !ids.has(node.id), 'Duplicate or missing node ID');
        requireValue(['Node', 'PrefabInstance'].includes(node.kind), `Invalid node kind: ${node.id}`);
        requireValue(typeof node.name === 'string' && typeof node.active === 'boolean', `Invalid node: ${node.id}`);
        requireValue(Number.isInteger(node.siblingIndex) && node.siblingIndex >= 0, 'Invalid siblingIndex');
        const position = JSON.stringify([node.parentId, node.siblingIndex]);
        requireValue(!positions.has(position), 'Duplicate sibling position');
        positions.add(position);
        requireValue(Array.isArray(node.components), 'components must be an array');
        const components = new Set();
        for (const component of node.components)
        {
            requireValue(typeof component.id === 'string' && !components.has(component.id), 'Duplicate component ID');
            components.add(component.id);
            requireValue(record(component.properties) && allowedComponents.has(component.type), `Unsupported component: ${component.type}`);
            requireValue(!Object.keys(component.properties).some(key => /m_Script|m_PersistentCalls/.test(key)), 'Custom code reference is forbidden');
        }
        if (node.rect !== null)
        {
            requireValue(record(node.rect), 'rect must be an object or null');
            for (const key of ['anchorMin', 'anchorMax', 'pivot', 'anchoredPosition', 'sizeDelta'])
            {
                requireValue(Array.isArray(node.rect[key]) && node.rect[key].length === 2 && node.rect[key].every(Number.isFinite), `Invalid rect.${key}`);
            }
        }
        if (node.kind === 'PrefabInstance')
        {
            requireValue(document.resources[node.resourceRef]?.kind === 'prefab' && Array.isArray(node.overrides), 'Invalid prefab instance reference');
        }
        ids.set(node.id, node);
    }
    const roots = nodes.filter(node => node.parentId === null);
    requireValue(roots.length === 1 && roots[0].id === document.prefab.rootNodeId, 'Exactly one matching root is required');
    for (const node of nodes)
    {
        const seen = new Set([node.id]);
        let parent = node.parentId;
        while (parent !== null)
        {
            requireValue(ids.has(parent) && !seen.has(parent), 'Missing parent or hierarchy cycle');
            seen.add(parent);
            parent = ids.get(parent).parentId;
        }
    }
    const inspectReferences = value =>
    {
        if (!value || typeof value !== 'object')
        {
            return;
        }
        if (Object.hasOwn(value, 'nodeId'))
        {
            requireValue(ids.has(value.nodeId), `Unknown node reference: ${value.nodeId}`);
            if (value.componentType !== undefined && value.componentType !== null)
            {
                requireValue(allowedComponents.has(value.componentType) || ['UnityEngine.Transform', 'UnityEngine.RectTransform'].includes(value.componentType), 'Custom component reference is forbidden');
            }
        }
        for (const child of Object.values(value))
        {
            inspectReferences(child);
        }
    };
    nodes.forEach(node => inspectReferences(node.components));
    for (const resource of Object.values(document.resources))
    {
        requireValue(resource.kind === 'prefab' && typeof resource.id === 'string' && typeof resource.version === 'string', 'First-stage resources must be versioned prefabs');
    }
    return document;
}

// Exact names prevent project subclasses from silently becoming standard components.
export const allowedComponents = new Set([
    'UnityEngine.Canvas', 'UnityEngine.CanvasRenderer', 'UnityEngine.CanvasGroup',
    ...['Image', 'RawImage', 'Text', 'Button', 'Toggle', 'ToggleGroup', 'Slider', 'Scrollbar',
        'ScrollRect', 'RectMask2D', 'Mask', 'HorizontalLayoutGroup', 'VerticalLayoutGroup',
        'GridLayoutGroup', 'LayoutElement', 'ContentSizeFitter', 'AspectRatioFitter',
        'CanvasScaler', 'GraphicRaycaster', 'Dropdown', 'InputField'].map(name => `UnityEngine.UI.${name}`),
    'TMPro.TextMeshProUGUI', 'TMPro.TMP_InputField', 'TMPro.TMP_Dropdown'
]);

export async function loadBatch(input, manifestName = "manifest.json")
{
    requireValue(manifestName === path.basename(manifestName), "Manifest name must be a filename");
    const root = await realpath(input);
    const manifest = JSON.parse(await readFile(path.join(root, manifestName), 'utf8'));
    requireValue(manifest.schemaVersion === 'ui-export/1' && typeof manifest.sourceKey === 'string' && manifest.sourceKey.trim(), 'Invalid manifest');
    // Offline exports declare completeness; never silently import a failed directory scan.
    requireValue(!manifest.failed || manifest.failed === 0, 'Export contains failures; inspect report.json and export a complete subset before import');
    requireValue(Array.isArray(manifest.entries) && manifest.entries.length > 0 && manifest.entries.length <= 10000, 'Empty or oversized batch');
    const safeRead = async relative =>
    {
        requireValue(typeof relative === 'string' && !path.isAbsolute(relative), 'Visual path must be relative');
        const file = await realpath(path.resolve(root, relative));
        const contained = path.relative(root, file);
        requireValue(contained !== '..' && !contained.startsWith(`..${path.sep}`) && !path.isAbsolute(contained), 'Visual path escapes export directory');
        return readFile(file);
    };
    const visualResources = new Map();
    const blobs = new Map();
    for (const resource of manifest.visualResources ?? [])
    {
        requireValue(typeof resource.id === 'string' && !visualResources.has(resource.id) && typeof resource.kind === 'string' && Array.isArray(resource.dependencies), 'Invalid visual resource');
        if (resource.blob)
        {
            const bytes = await safeRead(resource.blob.file);
            requireValue(bytes.length <= 64 * 1024 * 1024 && bytes.length === resource.blob.byteLength, 'Invalid visual blob size');
            requireValue(createHash('sha256').update(bytes).digest('hex') === resource.blob.sha256, 'Visual blob hash mismatch');
            blobs.set(resource.blob.sha256, bytes);
        }
        visualResources.set(resource.id, resource);
    }
    for (const resource of visualResources.values())
    {
        requireValue(resource.dependencies.every(id => visualResources.has(id)), 'Missing visual dependency');
    }
    const entries = [];
    const ids = new Set();
    for (const entry of manifest.entries)
    {
        requireValue(typeof entry.guid === 'string' && /^[a-f0-9]{32}$/.test(entry.guid) && !ids.has(entry.guid), 'Invalid or duplicate source GUID');
        ids.add(entry.guid);
        requireValue(typeof entry.file === 'string' && !path.isAbsolute(entry.file), 'Entry path must be relative');
        const file = await realpath(path.resolve(root, entry.file));
        const relative = path.relative(root, file);
        requireValue(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Entry escapes export directory');
        const document = validateDocument(JSON.parse(await readFile(file, 'utf8')));
        requireValue(Array.isArray(entry.diagnostics), 'Missing diagnostics');
        requireValue(typeof entry.sourceRevision === 'string' && entry.sourceRevision.length > 0, 'Missing source revision');
        requireValue(['supported', 'adaptation-required', 'reference-only'].includes(entry.grade), 'Invalid grade');
        requireValue(entry.grade !== 'supported' || entry.diagnostics.length === 0, 'Diagnostics cannot be marked fully supported');
        requireValue(typeof entry.assetPath === 'string' && /^(Assets|Packages|LocalPackages)\//.test(entry.assetPath) && !entry.assetPath.split('/').includes('..'), 'Invalid source asset path');
        let visual = null;
        const closure = new Map();
        if (entry.visualFile)
        {
            visual = JSON.parse((await safeRead(entry.visualFile)).toString('utf8'));
            requireValue(visual.schemaVersion === 'ui-visual/1' && Array.isArray(visual.bindings) && Array.isArray(visual.components), 'Invalid visual document');
            const nodeIds = new Set(document.prefab.nodes.map(node => node.id));
            const visitVisual = id =>
            {
                if (closure.has(id)) return;
                const resource = visualResources.get(id);
                requireValue(resource, 'Missing visual resource');
                closure.set(id, resource);
                resource.dependencies.forEach(visitVisual);
            };
            for (const id of visual.evidenceResourceIds ?? [])
            {
                visitVisual(id);
            }
            for (const binding of [...visual.bindings, ...visual.components])
            {
                requireValue(nodeIds.has(binding.nodeId), 'Unknown visual node');
                if (binding.resourceId) visitVisual(binding.resourceId);
            }
        }
        const visuals = [...closure.values()].sort((a, b) => a.id.localeCompare(b.id));
        entries.push({ ...entry, document, visual, visuals, metadata: { unityVersion: manifest.unityVersion ?? null, exporterVersion: manifest.exporterVersion ?? null }, contentHash: hash({ document, visual, visuals, diagnostics: entry.diagnostics, grade: entry.grade, sourceRevision: entry.sourceRevision }) });
    }
    const byId = new Map(entries.map(entry => [entry.guid, entry]));
    const visited = new Set();
    const active = new Set();
    const ordered = [];
    const visit = entry =>
    {
        requireValue(!active.has(entry.guid), 'Prefab dependency cycle');
        if (visited.has(entry.guid))
        {
            return;
        }
        active.add(entry.guid);
        for (const resource of Object.values(entry.document.resources))
        {
            const target = byId.get(resource.id);
            requireValue(target && resource.version === target.sourceRevision, 'Missing or mismatched prefab dependency');
            visit(target);
        }
        active.delete(entry.guid);
        visited.add(entry.guid);
        ordered.push(entry);
    };
    entries.forEach(visit);
    return { sourceKey: manifest.sourceKey, blobs, entries: ordered, batchHash: hash(manifest) };
}

export async function importBatch(pool, batch, dryRun = false)
{
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        // Serialize library writes; uniqueness constraints remain the final guard.
        await client.query('SELECT pg_advisory_xact_lock(70928024)');
        await client.query('INSERT INTO ui_library.sources(source_key) VALUES($1) ON CONFLICT DO NOTHING', [batch.sourceKey]);
        const result = { success: true, dryRun, inserted: 0, skipped: 0, versions: [] };
        for (const [digest, bytes] of batch.blobs ?? [])
        {
            await client.query('INSERT INTO ui_library.visual_blobs(hash,bytes,byte_length) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [digest, bytes, bytes.length]);
        }
        const versions = new Map();
        for (const entry of batch.entries)
        {
            const template = await client.query(`INSERT INTO ui_library.templates(source_key,source_guid,name,asset_path)
                VALUES($1,$2,$3,$4) ON CONFLICT(source_key,source_guid) DO UPDATE SET name=excluded.name,asset_path=excluded.asset_path RETURNING id`,
            [batch.sourceKey, entry.guid, entry.document.prefab.name, entry.assetPath]);
            // Dependency versions participate in identity, even when local layout is unchanged.
            const dependencies = Object.entries(entry.document.resources).map(([alias, resource]) => [alias, versions.get(resource.id)]);
            const contentHash = hash({ content: entry.contentHash, dependencies });
            const inserted = await client.query(`INSERT INTO ui_library.versions(template_id,content_hash,document,diagnostics,grade,source_revision,extraction_metadata)
                VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
            [template.rows[0].id, contentHash, entry.document, JSON.stringify(entry.diagnostics), entry.grade, entry.sourceRevision, entry.metadata]);
            const version = inserted.rows[0] ?? (await client.query('SELECT id FROM ui_library.versions WHERE template_id=$1 AND content_hash=$2', [template.rows[0].id, contentHash])).rows[0];
            versions.set(entry.guid, version.id);
            result[inserted.rowCount ? 'inserted' : 'skipped']++;
            for (const [alias, target] of dependencies)
            {
                await client.query('INSERT INTO ui_library.dependencies VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [version.id, alias, target]);
            }
            if (entry.visual)
            {
                await client.query('INSERT INTO ui_library.visual_bindings VALUES($1,$2) ON CONFLICT DO NOTHING', [version.id, entry.visual]);
                for (const resource of entry.visuals)
                {
                    await client.query('INSERT INTO ui_library.visual_resources VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [version.id, resource.id, resource.kind, resource, resource.blob?.sha256 ?? null]);
                }
            }
            result.versions.push({ guid: entry.guid, id: version.id, grade: entry.grade });
        }
        await client.query('INSERT INTO ui_library.imports(source_key,batch_hash,result) VALUES($1,$2,$3)', [batch.sourceKey, batch.batchHash, result]);
        await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
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
