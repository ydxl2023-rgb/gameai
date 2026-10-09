import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createPool, databaseEnabled } from '../database/connection.js';
import { agentOptions, createAgent, addAgentSkills, AgentInputError } from '../database/agents.js';

const capability = randomBytes(32).toString('hex');
let writer: ReturnType<typeof createPool> | undefined;
const reader = databaseEnabled() ? createPool() : undefined;

function reply(response: ServerResponse, status: number, body: unknown)
{
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
}

export async function handleAgentRequest(request: IncomingMessage, response: ServerResponse)
{
    if (!reader || process.env.GAMEAI_LOCAL_AGENT_MANAGEMENT !== 'true')
    {
        reply(response, 403, { error: '本机 Agent 管理尚未启用。' });
        return;
    }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const projectKey = process.env.GAMEAI_PROJECT_KEY ?? 'DEMO';
    try
    {
        if (path === '/api/track/agent-options' && request.method === 'GET')
        {
            reply(response, 200, { ...await agentOptions(reader, projectKey), capability });
            return;
        }
        if (!['/api/track/agents','/api/track/agent-skills'].includes(path) || request.method !== 'POST')
        {
            reply(response, 405, { error: '方法不允许。' });
            return;
        }
        // This capability is limited to local configuration, never human approval or task execution.
        const origin = 'http://' + request.headers.host;
        if (request.headers.origin !== origin || request.headers['x-gameai-agent-capability'] !== capability || !request.headers['content-type']?.startsWith('application/json'))
        {
            reply(response, 403, { error: '本机管理会话无效，请关闭表单后重新打开。' });
            return;
        }
        let body = '';
        for await (const chunk of request)
        {
            body += chunk.toString();
            if (Buffer.byteLength(body) > 16384)
            {
                reply(response, 413, { error: '提交内容过大。' });
                return;
            }
        }
        let input;
        try { input = JSON.parse(body); }
        catch { reply(response, 400, { error: '提交内容不是有效 JSON。' }); return; }
        if (!writer)
        {
            const config = parseEnv(await readFile(new URL('../../.env.agent-manager', import.meta.url), 'utf8'));
            if (!config.PGUSER || !config.PGPASSWORD) throw new Error('Missing writer configuration');
            writer = createPool({ user: config.PGUSER, password: config.PGPASSWORD });
        }
        reply(response, 200, await (path === '/api/track/agent-skills' ? addAgentSkills(writer,projectKey,input) : createAgent(writer, projectKey, input)));
    }
    catch (error)
    {
        reply(response, error instanceof AgentInputError ? 400 : 503, { error: error instanceof AgentInputError ? error.message : 'Agent 配置保存服务不可用，请检查数据库与技能目录。' });
    }
}
