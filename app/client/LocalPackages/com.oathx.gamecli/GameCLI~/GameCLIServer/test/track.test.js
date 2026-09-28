import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGameCliServer } from '../src/server.js';
import { handleTrackRequest, resourceUri } from '../dist/track/http.js';

async function setup(t)
{
    const app = createGameCliServer({ webhookToken: 'a'.repeat(32), projects: ['DEMO'], additionalHttpHandler: handleTrackRequest });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    t.after(() => app.close());
    return `http://127.0.0.1:${app.server.address().port}`;
}

test('MCP discovery, resource and repeated read-only calls use the actual HTTP transport', async t =>
{
    const base = await setup(t);
    const client = new Client({ name: 'track-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
    t.after(() => client.close());
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['gameai_track_open', 'gameai_track_snapshot']);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
    assert.equal(tools.find(tool => tool.name === 'gameai_track_open')._meta.ui.resourceUri, resourceUri);
    assert.equal(tools.find(tool => tool.name === 'gameai_track_snapshot')._meta, undefined);
    const resource = await client.readResource({ uri: resourceUri });
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(resource.contents[0].text, /ui\/initialize/);
    assert.ok(!resource.contents[0].text.includes('/* TRACK_BUNDLE */'));
    const first = await client.callTool({ name: 'gameai_track_open', arguments: {} });
    const next = await client.callTool({ name: 'gameai_track_snapshot', arguments: {} });
    assert.equal(first.structuredContent.mode, 'demo');
    assert.equal(first.structuredContent.tasks.length, 3);
    assert.notEqual(first.structuredContent.request_id, next.structuredContent.request_id);
    assert.ok(first.structuredContent.tasks.every(task => task.task.startsWith('DEMO-')));
    const unknown = await client.callTool({ name: 'approve_requirement', arguments: {} });
    assert.equal(unknown.isError, true);
});

test('preview, malformed requests, local origin boundary and existing health route', async t =>
{
    const base = await setup(t);
    assert.equal((await fetch(base + '/health')).status, 200);
    const page = await fetch(base + '/track');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /浏览器预览仅验证网页与 HTTP/);
    const snapshot = await (await fetch(base + '/api/track/demo')).json();
    assert.equal(snapshot.mode, 'demo');
    assert.equal((await fetch(base + '/api/track/demo', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/api/track/demo', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{' })).status, 400);
    assert.equal((await fetch(base + '/not-a-route')).status, 404);
});

test('Codex-managed stdio works without an HTTP listener and exits with the client', async () =>
{
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const { fileURLToPath } = await import('node:url');
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/track/stdio.js', import.meta.url))], stderr: 'pipe' });
    const client = new Client({ name: 'track-stdio-test', version: '1.0.0' });
    try
    {
        await client.connect(transport);
        const listing = await client.listTools();
        assert.equal(listing.tools.length, 2);
        const response = await client.callTool({ name: 'gameai_track_open', arguments: {} });
        assert.equal(response.structuredContent.mode, 'demo');
        assert.equal(response.structuredContent.tasks.length, 3);
        const resource = await client.readResource({ uri: resourceUri });
        assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    }
    finally
    {
        await client.close();
    }
});
