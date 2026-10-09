import { randomUUID } from 'node:crypto';
import workbench from './workbench.json' with { type: 'json' };
import { createPool, databaseEnabled } from '../database/connection.js';
import { readLinkedHtml } from '../database/documents.js';
import { readWorkbench } from '../database/store.js';
const pool = databaseEnabled() ? createPool() : null;
export async function createSnapshot()
{
    if (pool)
    {
        const result = await readWorkbench(pool, process.env.GAMEAI_PROJECT_KEY ?? 'DEMO');
        return {
            schema_version: 2,
            mode: 'postgres',
            is_test: result.is_test,
            server_time: new Date().toISOString(),
            request_id: randomUUID(),
            notice: '数据来自 PostgreSQL；人工审批在本机登录页面完成，后续执行遵循 Agent 自动配置。',
            review_url: 'http://127.0.0.1:' + (process.env.GAMECLI_TRACK_PORT ?? '18090') + '/track',
            workbench: result.workbench
        };
    }
    return {
        schema_version: 2,
        mode: 'demo',
        server_time: new Date().toISOString(),
        request_id: randomUUID(),
        notice: '模拟工作台：未连接数据库，不创建任务、不启动 Agent。',
        workbench: structuredClone(workbench)
    };
}

export async function readDocument(id: string)
{
    return pool ? readLinkedHtml(pool, process.env.GAMEAI_PROJECT_KEY ?? 'DEMO', id) : null;
}
