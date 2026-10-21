import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {projectRoot,tempRoot} from '../paths.js';
import {agentRunRequest} from '../database/agent-runs.js';

const receiptSchema=z.object({execution_id:z.string().regex(/^[a-f0-9]{32}$/),worker_key:z.string().min(1).max(100),state:z.literal('failed'),stopped_at:z.iso.datetime({offset:true})}).strict();

export function verifyStopReceipt(raw,key,run)
{
    const envelope=JSON.parse(raw);
    if (typeof envelope.payload!=='string' || envelope.payload.length>4096 || !/^[a-f0-9]{64}$/.test(envelope.signature ?? ''))
    {
        throw new Error('停止凭据封装无效');
    }
    const expected=createHmac('sha256',key).update(envelope.payload).digest();
    if (!timingSafeEqual(expected,Buffer.from(envelope.signature,'hex')))
    {
        throw new Error('停止凭据签名无效');
    }
    const payload=receiptSchema.parse(JSON.parse(envelope.payload));
    if (payload.execution_id!==run.execution_id || payload.worker_key!==run.worker_key ||
        new Date(payload.stopped_at)<new Date(run.started_at) || new Date(payload.stopped_at)>new Date(Date.now()+30000))
    {
        throw new Error('停止凭据与原执行、节点或时间不匹配');
    }
    return payload;
}

export async function recoverStoppedAgents(pool,{projectId=null,read=readFile,report=agentRunRequest}={})
{
    const rows=(await pool.query(`SELECT r.*,s.project_id,p.project_key,w.worker_key FROM gameai.agent_runs r
        JOIN gameai.agent_conversations s ON s.id=r.conversation_id JOIN gameai.projects p ON p.id=s.project_id
        JOIN gameai.workers w ON w.id=s.worker_id
        WHERE r.state IN ('running','unknown') AND r.expires_at<now()
        AND ($1::uuid IS NULL OR s.project_id=$1) ORDER BY r.expires_at LIMIT 50`,[projectId])).rows;
    let config;
    for (const run of rows)
    {
        try
        {
            const raw=await read(join(tempRoot,'agent-stops',run.execution_id+'.json'),'utf8');
            // Credentials remain in the host; neither the signed receipt nor audits contain them.
            if (!config)
            {
                config=JSON.parse(await read(join(projectRoot,'.gamecli/client.json'),'utf8'));
            }
            if (config.worker_key!==run.worker_key || typeof config.token!=='string' || !config.token)
            {
                continue;
            }
            const payload=verifyStopReceipt(raw,config.token,run);
            await report(pool,run.project_key,{action:'finish',execution_id:payload.execution_id,worker_key:payload.worker_key,state:'failed',error:'原节点已签名确认其拥有的 Agent 进程停止；恢复原任务检查点'});
        }
        catch (error)
        {
            if (error.code==='ENOENT')
            {
                continue;
            }
            await pool.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload)
                SELECT $1,'orchestrator','停止凭据需要核验',$2::jsonb WHERE NOT EXISTS(
                    SELECT 1 FROM gameai.audit_events WHERE project_id=$1 AND event='停止凭据需要核验' AND payload->>'execution_id'=$3)`,
            [run.project_id,{execution_id:run.execution_id,reason:'停止凭据不能匹配原执行；保留未知状态与占用，不自动重跑'},run.execution_id]);
        }
    }
}
