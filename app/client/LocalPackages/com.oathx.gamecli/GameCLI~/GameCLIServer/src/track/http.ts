import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createSnapshot } from './snapshot.js';

export const resourceUri = 'ui://gameai-track/v1.html';
const mimeType = 'text/html;profile=mcp-app';
const htmlUrl = new URL('../../public/track.html', import.meta.url);

export function createMcpServer(html: string)
{
    const server = new McpServer({ name: 'gameai-track', version: '0.1.0' });
    server.registerResource('gameai-track', resourceUri, { mimeType }, async () => ({
        contents: [{ uri: resourceUri, mimeType, text: html, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }]
    }));
    const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    const reply = async () => ({
        content: [{ type: 'text' as const, text: 'GameAI Track 接入验证：仅模拟数据，未读取或修改 JIRA。' }],
        structuredContent: createSnapshot()
    });
    server.registerTool('gameai_track_open', {
        description: '打开 GameAI Track 最小 UI 接入验证组件。仅模拟数据，不运行 Agent。',
        inputSchema: {}, annotations,
        _meta: { ui: { resourceUri }, 'openai/outputTemplate': resourceUri }
    }, reply);
    server.registerTool('gameai_track_snapshot', {
        description: '刷新 GameAI Track 模拟快照；返回本次服务器时间和请求编号，不代表实际项目状态。',
        inputSchema: {}, annotations
    }, reply);
    return server;
}

function json(response: ServerResponse, status: number, value: unknown)
{
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
}

export async function handleTrackRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean>
{
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!['/mcp', '/track', '/api/track/demo'].includes(path))
    {
        return false;
    }
    // This probe is local-only and read-only. Do not expose a new anonymous business API.
    const peer = request.socket.remoteAddress;
    const host = request.headers.host ?? '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
    {
        json(response, 403, { error: '最小接入验证仅允许本机访问。' });
        return true;
    }
    if (request.headers.origin && !['http://' + host, 'https://' + host].includes(request.headers.origin))
    {
        json(response, 403, { error: '请求来源不允许。' });
        return true;
    }
    if (path === '/api/track/demo')
    {
        json(response, request.method === 'GET' ? 200 : 405, request.method === 'GET' ? createSnapshot() : { error: '方法不允许。' });
        return true;
    }
    if (path === '/track')
    {
        if (request.method !== 'GET')
        {
            json(response, 405, { error: '方法不允许。' });
            return true;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(await readFile(htmlUrl, 'utf8'));
        return true;
    }
    // Stateless request/response tools need no persistent SSE stream.
    if (request.method !== 'POST')
    {
        response.setHeader('Allow', 'POST');
        json(response, 405, { error: 'MCP 接入验证只接受 POST 请求。' });
        return true;
    }
    const server = createMcpServer(await readFile(htmlUrl, 'utf8'));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.once('close', () =>
    {
        void transport.close();
        void server.close();
    });
    try
    {
        await server.connect(transport);
        await transport.handleRequest(request, response);
    }
    catch
    {
        if (!response.headersSent)
        {
            json(response, 500, { error: 'MCP 请求失败，请检查服务日志。' });
        }
        else
        {
            response.end();
        }
    }
    return true;
}
