import { handleReviewRequest } from './review-http.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createSnapshot, readDocument } from './snapshot.js';
import { handleAgentRequest } from './agent-http.js';
import { agentHistory } from './agent-history.js';
import { z } from 'zod';

export const resourceUri = 'ui://gameai-track/v3.html';
const mimeType = 'text/html;profile=mcp-app';
const htmlUrl = new URL('../../public/track.html', import.meta.url);

export function createMcpServer(html: string)
{
    const server = new McpServer({ name: 'gameai-track', version: '0.1.0' });
    server.registerResource('gameai-track', resourceUri, { mimeType }, async () => ({
        contents: [{ uri: resourceUri, mimeType, text: html, _meta: { 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'] }, ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }]
    }));
    const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    const reply = async (input: { document_version?: string } = {}) =>
    {
        try
        {
            const snapshot = await createSnapshot();
            if (input.document_version)
            {
                const rows = 'requirements' in snapshot.workbench ? snapshot.workbench.requirements : [];
                const taskRows = 'tasks' in snapshot.workbench ? snapshot.workbench.tasks : [];
                const linkedTasks = taskRows.map((task: any) => ({ version_id: task.requirement_version_id, document_url: task.document_url }));
                const row = [...rows, ...linkedTasks].find((item: {version_id: string; document_url?: string | null}) => item.version_id === input.document_version);
                const artifactId = row?.document_url ? /\/documents\/([0-9a-f-]{36})$/i.exec(row.document_url)?.[1] : null;
                const bytes = artifactId ? await readDocument(artifactId) : null;
                if (!bytes) throw new Error('未找到关联的 HTML 文档。');
                return { content: [], structuredContent: { ...snapshot, document: { version_id: input.document_version, html: bytes.toString('utf8') } } };
            }
            return { content: [{ type: 'text' as const, text: snapshot.notice }], structuredContent: snapshot };
        }
        catch
        {
            return { isError: true, content: [{ type: 'text' as const, text: '数据库读取失败，请检查数据库服务及本机连接配置。' }] };
        }
    };
    server.registerTool('gameai_track_open', {
        description: '打开 GameAI Track 工作台，读取已配置的数据源；不执行审批或派工。',
        inputSchema: {}, annotations,
        _meta: { ui: { resourceUri }, 'openai/outputTemplate': resourceUri }
    }, reply);
    server.registerTool('gameai_track_snapshot', {
        description: '刷新 GameAI Track 数据库或演示快照，返回数据来源及测试数据标记。',
        inputSchema: { document_version: z.uuid().optional() }, annotations
    }, reply);
    server.registerTool('gameai_agent_history', {
        description: '读取当前项目 Agent 已绑定会话的用户消息与公开回复，不启动或恢复任务。',
        inputSchema: { agent: z.string(), conversation: z.string().optional(), page: z.number().int().positive().optional() },
        annotations
    }, async ({ agent, conversation, page }) =>
    {
        try
        {
            return { content: [], structuredContent: await agentHistory(agent, conversation, page) };
        }
        catch (error)
        {
            return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : '历史读取失败。' }] };
        }
    });
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
    const documentId = /^\/api\/track\/documents\/([0-9a-f-]{36})$/i.exec(path)?.[1];
    if (!documentId && !['/mcp', '/track', '/api/track/demo', '/api/track/snapshot', '/api/track/agent-history', '/api/track/agents', '/api/track/agent-skills', '/api/track/agent-options', '/api/track/agent-runs', '/api/track/requirements', '/api/track/review-session', '/api/track/review-login', '/api/track/review-logout', '/api/track/review-decisions', '/api/track/review-pm-split', '/api/track/review-agent-automation', '/api/track/review-task-selection', '/api/track/review-task-preview', '/api/track/review-task-dispatch'].includes(path))
    {
        return false;
    }
    // Local configuration routes share the loopback boundary; remote business access stays closed.
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
    if (path === '/api/track/agent-runs' || path === '/api/track/requirements' || path.startsWith('/api/track/review-'))
    {
        await handleReviewRequest(request, response);
        return true;
    }
    if (path === '/api/track/agent-history')
    {
        if (request.method !== 'GET')
        {
            json(response, 405, { error: '方法不允许。' });
            return true;
        }
        const query = new URL(request.url!, 'http://localhost').searchParams;
        try
        {
            json(response, 200, await agentHistory(query.get('agent') ?? '', query.get('conversation') ?? undefined, Number(query.get('page') ?? 1)));
        }
        catch (error)
        {
            json(response, 409, { error: error instanceof Error ? error.message : '历史读取失败。' });
        }
        return true;
    }
    if (path === '/api/track/agent-skills' || path === '/api/track/agents' || path === '/api/track/agent-options')
    {
        await handleAgentRequest(request, response);
        return true;
    }
    if (documentId)
    {
        if (request.method !== 'GET')
        {
            json(response, 405, { error: '方法不允许。' });
            return true;
        }
        try
        {
            const bytes = await readDocument(documentId);
            if (!bytes) json(response, 404, { error: '未找到关联的 HTML 文档。' });
            else
            {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'" });
                response.end(bytes);
            }
        }
        catch
        {
            json(response, 409, { error: '原始 HTML 不可用或内容已改变，请核对关联版本。' });
        }
        return true;
    }
    if (path === '/api/track/demo' || path === '/api/track/snapshot')
    {
        try
        {
            json(response, request.method === 'GET' ? 200 : 405, request.method === 'GET' ? await createSnapshot() : { error: '方法不允许。' });
        }
        catch
        {
            json(response, 503, { error: '数据库读取失败，请检查数据库服务及本机连接配置。' });
        }
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
