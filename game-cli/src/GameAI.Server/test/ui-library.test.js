import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, hash, validateDocument, loadBatch, importBatch } from '../src/ui-library/library.js';

function document()
{
    return {
        schemaVersion: 'ui-template/1', resources: {},
        prefab: { name: 'UITest', rootNodeId: 'root', nodes: [
            { id: 'root', kind: 'Node', name: 'UITest', parentId: null, siblingIndex: 0, active: true,
                rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [-17, 0] }, components: [] }
        ] }
    };
}

test('canonical hash ignores object insertion order and retains array order', () =>
{
    assert.equal(hash({ b: 1, a: 2 }), hash({ a: 2, b: 1 }));
    assert.notEqual(hash([1, 2]), hash([2, 1]));
    assert.equal(JSON.parse(canonical(document())).prefab.name, 'UITest');
});

test('stretch sizeDelta may be negative', () => assert.equal(validateDocument(document()).prefab.nodes[0].rect.sizeDelta[0], -17));

test('reject duplicate nodes, missing parents and nonfinite dimensions', () =>
{
    let value = document();
    value.prefab.nodes.push(structuredClone(value.prefab.nodes[0]));
    assert.throws(() => validateDocument(value), /Duplicate/);
    value = document();
    value.prefab.nodes.push({ ...value.prefab.nodes[0], id: 'child', parentId: 'missing' });
    assert.throws(() => validateDocument(value), /Missing parent/);
    value = document();
    value.prefab.nodes[0].rect.sizeDelta[0] = NaN;
    assert.throws(() => validateDocument(value), /Invalid rect/);
});

test('reject custom components and callback references', () =>
{
    const value = document();
    value.prefab.nodes[0].components = [{ id: 'button', type: 'Project.Login', properties: {} }];
    assert.throws(() => validateDocument(value), /Unsupported component/);
    value.prefab.nodes[0].components[0] = { id: 'button', type: 'UnityEngine.UI.Button', properties: { 'onClick.m_PersistentCalls': {} } };
    assert.throws(() => validateDocument(value), /Custom code/);
});

test('reject hierarchy cycle and dangling component node reference', () =>
{
    const value = document();
    value.prefab.nodes.push({ ...value.prefab.nodes[0], id: 'a', parentId: 'b' }, { ...value.prefab.nodes[0], id: 'b', parentId: 'a' });
    assert.throws(() => validateDocument(value), /cycle/);
    const referenced = document();
    referenced.prefab.nodes[0].components.push({ id: 'scroll', type: 'UnityEngine.UI.ScrollRect', properties: { m_Content: { nodeId: 'unknown' } } });
    assert.throws(() => validateDocument(referenced), /Unknown node/);
});

async function packageFixture()
{
    const root = await mkdtemp(path.join(tmpdir(), 'gameai-ui-test-'));
    const entry = { guid: 'a'.repeat(32), assetPath: 'Assets/UITest.prefab', file: 'prefab.json', sourceRevision: 'r1', grade: 'supported', diagnostics: [] };
    const manifest = { schemaVersion: 'ui-export/1', sourceKey: `test-${randomUUID()}`, entries: [entry] };
    await writeFile(path.join(root, entry.file), JSON.stringify(document()));
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    return { root, entry, manifest };
}

test('load export package and reject file escape and incomplete dependencies', async () =>
{
    const fixture = await packageFixture();
    try
    {
        assert.equal((await loadBatch(fixture.root)).entries.length, 1);
        const value = document();
        value.resources.missing = { kind: 'prefab', id: 'b'.repeat(32), version: 'r1' };
        await writeFile(path.join(fixture.root, 'prefab.json'), JSON.stringify(value));
        await assert.rejects(loadBatch(fixture.root), /Missing or mismatched/);
        fixture.manifest.entries[0].file = path.join(fixture.root, 'prefab.json');
        await writeFile(path.join(fixture.root, 'manifest.json'), JSON.stringify(fixture.manifest));
        await assert.rejects(loadBatch(fixture.root), /relative/);
    }
    finally
    {
        await rm(fixture.root, { recursive: true });
    }
});

test('incomplete offline scan cannot silently import successful subset', async () =>
{
    const fixture = await packageFixture();
    try
    {
        fixture.manifest.failed = 1;
        await writeFile(path.join(fixture.root, 'manifest.json'), JSON.stringify(fixture.manifest));
        await assert.rejects(loadBatch(fixture.root), /Export contains failures/);
    }
    finally
    {
        await rm(fixture.root, { recursive: true });
    }
});

test('PostgreSQL dry-run, concurrent idempotency and changed version', { skip: process.env.UI_LIBRARY_DB_TEST !== '1' }, async () =>
{
    const { createPool } = await import('../src/database/connection.js');
    const pool = createPool();
    const fixture = await packageFixture();
    try
    {
        const batch = await loadBatch(fixture.root);
        assert.equal((await importBatch(pool, batch, true)).inserted, 1);
        assert.equal((await pool.query('SELECT * FROM ui_library.sources WHERE source_key=$1', [batch.sourceKey])).rowCount, 0);
        const concurrent = await Promise.all([importBatch(pool, batch), importBatch(pool, batch)]);
        assert.equal(concurrent.reduce((sum, result) => sum + result.inserted, 0), 1);
        assert.equal(concurrent.reduce((sum, result) => sum + result.skipped, 0), 1);
        const changed = document();
        changed.prefab.nodes[0].rect.sizeDelta[0] = -20;
        await writeFile(path.join(fixture.root, 'prefab.json'), JSON.stringify(changed));
        assert.equal((await importBatch(pool, await loadBatch(fixture.root))).inserted, 1);
        const rows = await pool.query(`SELECT v.id FROM ui_library.versions v JOIN ui_library.templates t ON t.id=v.template_id WHERE t.source_key=$1`, [batch.sourceKey]);
        assert.equal(rows.rowCount, 2);
    }
    finally
    {
        // Delete only the unique fixture source created by this test.
        const source = fixture.manifest.sourceKey;
        await pool.query('DELETE FROM ui_library.imports WHERE source_key=$1', [source]);
        await pool.query('DELETE FROM ui_library.versions WHERE template_id IN (SELECT id FROM ui_library.templates WHERE source_key=$1)', [source]);
        await pool.query('DELETE FROM ui_library.templates WHERE source_key=$1', [source]);
        await pool.query('DELETE FROM ui_library.sources WHERE source_key=$1', [source]);
        await pool.end();
        await rm(fixture.root, { recursive: true });
    }
});

test('visual evidence verifies blobs, node bindings and dependency closure', async () =>
{
    const { createHash } = await import('node:crypto');
    const root = await mkdtemp(path.join(tmpdir(), 'ui-visual-'));
    try
    {
        const bytes = Buffer.from('texture fixture');
        const digest = createHash('sha256').update(bytes).digest('hex');
        const manifest = { schemaVersion: 'ui-export/1', sourceKey: 'test', entries: [{ guid: 'a'.repeat(32), file: 'prefab.json', visualFile: 'visual.json', assetPath: 'Assets/Test.prefab', sourceRevision: '1', grade: 'reference-only', diagnostics: [] }], visualResources: [{ id: 'texture', kind: 'texture', dependencies: [], blob: { file: 'texture.bin', sha256: digest, byteLength: bytes.length } }] };
        const visual = { schemaVersion: 'ui-visual/1', bindings: [{ nodeId: 'root', resourceId: 'texture' }], components: [] };
        await writeFile(path.join(root, 'prefab.json'), JSON.stringify(document()));
        await writeFile(path.join(root, 'visual.json'), JSON.stringify(visual));
        await writeFile(path.join(root, 'texture.bin'), bytes);
        await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
        const batch = await loadBatch(root);
        assert.equal(batch.entries[0].visuals.length, 1);
        assert.deepEqual(batch.blobs.get(digest), bytes);
        await writeFile(path.join(root, 'texture.bin'), Buffer.from('Texture fixture'));
        await assert.rejects(loadBatch(root), /hash mismatch/);
        await writeFile(path.join(root, 'texture.bin'), bytes);
        visual.bindings[0].nodeId = 'missing';
        await writeFile(path.join(root, 'visual.json'), JSON.stringify(visual));
        await assert.rejects(loadBatch(root), /Unknown visual node/);
        visual.bindings[0].nodeId = 'root';
        await writeFile(path.join(root, 'visual.json'), JSON.stringify(visual));
        manifest.visualResources[0].dependencies = ['missing'];
        await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
        await assert.rejects(loadBatch(root), /Missing visual dependency/);
    }
    finally { await rm(root, { recursive: true, force: true }); }
});
