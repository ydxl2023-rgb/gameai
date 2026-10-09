import { hostname } from 'node:os';
import { createPool, databaseEnabled } from '../database/connection.js';
import { readConversation } from './conversation-reader.js';

let pool;
export async function agentHistory(agentKey, conversationId, page = 1)
{
    if (!databaseEnabled()) { throw new Error('演示模式没有真实对话历史。'); }
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(agentKey) || !Number.isInteger(page) || page < 1)
    {
        throw new Error('历史查询参数无效。');
    }
    pool ??= createPool();
    const projectKey = process.env.GAMEAI_PROJECT_KEY ?? 'DEMO';
    const sessions = (await pool.query(`SELECT s.id,s.requirement_key,s.thread_id,w.worker_key,
        (SELECT max(r.started_at) FROM gameai.agent_runs r WHERE r.conversation_id=s.id) last_run
        FROM gameai.agent_conversations s JOIN gameai.agents a ON a.id=s.agent_id
        JOIN gameai.workers w ON w.id=s.worker_id JOIN gameai.projects p ON p.id=s.project_id
        WHERE p.project_key=$1 AND a.agent_key=$2 ORDER BY last_run DESC NULLS LAST,s.requirement_key`,[projectKey,agentKey])).rows;
    if (!conversationId) { return { conversations:sessions }; }
    const session = sessions.find(s => s.id === conversationId);
    if (!session) { throw new Error('会话未关联到当前项目的这个 Agent。'); }
    if (!session.thread_id) { throw new Error('该会话尚未启动，暂无对话记录。'); }
    if (session.worker_key !== hostname().toLowerCase()) { throw new Error('会话位于其他工作站，尚未接入远程历史读取。'); }
    const messages = await readConversation(session.thread_id);
    const pageSize = 20;
    return { conversation_id:session.id, thread_id:session.thread_id, total:messages.length,
        page, page_size:pageSize, messages:messages.slice((page-1)*pageSize,page*pageSize) };
}
