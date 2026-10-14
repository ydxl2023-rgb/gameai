import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, selectClosure, convertEntry, createAssetPool } from '../src/asset-library/library.js';
import { validateVector } from '../src/asset-library/index.js';

test('source identity is deterministic and project scoped', () =>
{
    assert.equal(identity('sv', 'guid', '9007199254740999'), identity('sv', 'guid', '9007199254740999'));
    assert.notEqual(identity('sv', 'guid'), identity('other', 'guid'));
    assert.match(identity('sv'), /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('production adapter never falls back to Track database', () =>
{
    const prior = process.env.ASSET_DATABASE_URL;
    try
    {
        delete process.env.ASSET_DATABASE_URL;
        assert.throws(() => createAssetPool(), /required/);
        process.env.ASSET_DATABASE_URL = 'postgresql://test:unused@localhost/gameai';
        assert.throws(() => createAssetPool(), /Dedicated/);
    }
    finally
    {
        if (prior === undefined)
        {
            delete process.env.ASSET_DATABASE_URL;
        }
        else
        {
            process.env.ASSET_DATABASE_URL = prior;
        }
    }
});

test('single root imports dependency closure only', () =>
{
    const entry = (guid, resources = {}) => ({ guid, document: { resources } });
    const batch = { entries: [entry('child'), entry('other'), entry('root', { item: { id: 'child' } })] };
    assert.deepEqual(selectClosure(batch, 'root').map(item => item.guid), ['child', 'root']);
    assert.throws(() => selectClosure(batch, 'absent'));
});

test('invalid vectors never reach Qdrant', () =>
{
    assert.deepEqual(validateVector([1, 0], 2), [1, 0]);
    for (const vector of [[0, 0], [1], [NaN, 1], [Infinity, 1]])
    {
        assert.throws(() => validateVector(vector, 2));
    }
});

test('conversion does not invent style and rejects missing visual target', () =>
{
    const entry = { document: { prefab: { name: 'Login', nodes: [{ id: 'root', components: [] }] } }, metadata: {}, diagnostics: [], visual: { bindings: [], components: [] } };
    assert.equal(convertEntry(entry, 'id', [], []).visualProfile.status, 'not_analyzed');
    entry.visual.bindings.push({ nodeId: 'root', componentId: 'unknown', fileId: '1' });
    assert.throws(() => convertEntry(entry, 'id', [], []), /missing component/);
});
