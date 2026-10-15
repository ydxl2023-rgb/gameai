import test from 'node:test';
import assert from 'node:assert/strict';
import { indexPending } from '../src/asset-library/index.js';
import { hash } from '../src/ui-library/library.js';

test('resume skips stored chunks and marks done only after remaining writes succeed', async () =>
{
    const oldFetch = globalThis.fetch;
    const names = ['ASSET_OLLAMA_URL', 'ASSET_QDRANT_URL', 'ASSET_QDRANT_KEY', 'ASSET_EMBEDDING_MODEL'];
    const prior = names.map(name => process.env[name]);
    Object.assign(process.env, { ASSET_OLLAMA_URL: 'http://model.test', ASSET_QDRANT_URL: 'http://index.test', ASSET_QDRANT_KEY: 'test-only', ASSET_EMBEDDING_MODEL: 'fixture' });
    const version = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const hex = hash([version, 0]).slice(0, 32);
    const storedId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    let embeds = 0;
    let writes = 0;
    const updates = [];
    const client = {
        async query(sql)
        {
            if (sql.includes('SELECT j.version_id'))
            {
                return { rows: [{ version_id: version, summary: 'a'.repeat(2000), metadata: {}, name: 'Login' }] };
            }
            if (sql.startsWith('UPDATE'))
            {
                updates.push(sql);
            }
            return { rows: [] };
        },
        release() {},
    };
    const pool = {
        async query() { return { rows: [{ configuration: { model: 'fixture', digest: 'fixed', dimensions: 2, summaryVersion: 3 } }] }; },
        async connect() { return client; },
    };
    globalThis.fetch = async (url, options) =>
    {
        let data;
        if (url.pathname === '/api/tags')
        {
            data = { models: [{ name: 'fixture', digest: 'fixed' }] };
        }
        else if (url.pathname === '/api/embed')
        {
            embeds++;
            data = { embeddings: [[1, 0]] };
        }
        else if (options.method === 'POST')
        {
            data = { result: [{ id: storedId }] };
        }
        else
        {
            writes++;
            data = { result: {} };
        }
        return new Response(JSON.stringify(data), { status: 200 });
    };
    try
    {
        const result = await indexPending(pool, 'ui_aaaaaaaaaaaaaaaaaaaaaaaa');
        assert.equal(result.success, true);
        assert.equal(embeds, 1);
        assert.equal(writes, 1);
        assert.equal(updates.filter(sql => sql.includes("status='done'")).length, 1);
    }
    finally
    {
        globalThis.fetch = oldFetch;
        names.forEach((name, index) => prior[index] === undefined ? delete process.env[name] : process.env[name] = prior[index]);
    }
});
