import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareRestore } from '../src/ui-library/restore.js';

function fixture(missing = false)
{
    const bytes = Buffer.from('test-binary');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const document = { schemaVersion: 'ui-template/1', prefab: { nodes: [{ id: 'n', name: 'Label', components: [{ id: 'c', type: 'UnityEngine.UI.Image', properties: {} }] }] } };
    return { query: async sql => ({ rows: sql.includes('visual_bindings') ? [{ document: { bindings: [{ nodeId: 'n', componentId: 'c', property: 'm_Sprite', resourceId: 'r' }], components: [] } }] : sql.includes('visual_resources') ? (missing ? [] : [{ resource_id: 'r', bytes, descriptor: { blob: { extension: '.png', sha256, byteLength: bytes.length }, importer: { TextureImporter: { spriteMode: 1 } } } }]) : [{ document, diagnostics: [], content_hash: 'revision' }] }) };
}

test('prepare restores immutable bytes and binds imported sprite without editing input', async () =>
{
    const directory = await mkdtemp(path.join(tmpdir(), 'restore-'));
    try
    {
        const result = await prepareRestore(fixture(), '1', directory, 'Assets/Test');
        assert.equal(result.success, true);
        assert.equal(result.imports.length, 1);
        assert.equal((await readFile(result.imports[0].file)).toString(), 'test-binary');
        const snapshot = JSON.parse(await readFile(result.snapshot, 'utf8'));
        assert.equal(snapshot.prefab.nodes[0].components[0].properties.m_Sprite.assetPath, result.imports[0].target);
        await assert.rejects(prepareRestore(fixture(), '1', directory, 'Assets/Test'), /empty/);
    }
    finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing visual reference produces a blocking report', async () =>
{
    const directory = await mkdtemp(path.join(tmpdir(), 'restore-missing-'));
    try
    {
        const result = await prepareRestore(fixture(true), '1', directory, 'Assets/Test');
        assert.equal(result.success, false);
        assert.equal(result.blockers[0].code, 'unsupported-or-missing-visual-resource');
        assert.equal(result.imports.length, 0);
    }
    finally { await rm(directory, { recursive: true, force: true }); }
});

test('reject invalid identity and asset traversal', async () =>
{
    await assert.rejects(prepareRestore(fixture(), '-1', '', 'Assets/Test'), /version ID/);
    await assert.rejects(prepareRestore(fixture(), '1', '', 'Assets/../Escape'), /destination/);
});

test('approved missing font retains Unity default and records substitution', async () =>
{
    const directory = await mkdtemp(path.join(tmpdir(), 'restore-default-font-'));
    const pool = fixture(true);
    const query = pool.query;
    pool.query = async sql =>
    {
        const result = await query(sql);
        if (sql.includes('visual_bindings'))
        {
            result.rows[0].document.bindings[0].property = 'm_FontData.m_Font';
            result.rows[0].document.fontFallbackPolicy = { policy: 'target-default', reason: 'user-approved fallback' };
        }
        if (sql.includes('ui_library.versions'))
        {
            result.rows[0].document.prefab.nodes[0].components[0].type = 'UnityEngine.UI.Text';
        }
        return result;
    };
    try
    {
        const result = await prepareRestore(pool, '1', directory, 'Assets/Test');
        assert.equal(result.success, true);
        assert.ok(result.warnings.some(item => item.code === 'font-default-substitution'));
        assert.equal(result.imports.length, 0);
    }
    finally { await rm(directory, { recursive: true, force: true }); }
});

test('hidden visual hierarchy is blocked rather than exported as a successful blank preview', async () =>
{
    const directory = await mkdtemp(path.join(tmpdir(), 'restore-hidden-'));
    const pool = fixture();
    const query = pool.query;
    pool.query = async sql =>
    {
        const result = await query(sql);
        if (sql.includes('ui_library.versions')) result.rows[0].document.prefab.nodes[0].active = false;
        return result;
    };
    try
    {
        const result = await prepareRestore(pool, '1', directory, 'Assets/Test');
        assert.equal(result.success, false);
        assert.equal(result.blockers[0].code, 'no-active-visuals');
    }
    finally { await rm(directory, { recursive: true, force: true }); }
});
