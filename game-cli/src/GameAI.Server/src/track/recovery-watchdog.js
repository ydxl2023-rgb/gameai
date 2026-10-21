import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tempRoot} from '../paths.js';
import {saveTaskResponse,publishTaskResponse} from './task-publication.js';
import {finishReceivedTask} from './task-dispatch.js';

// A timeout is not stop proof. This watchdog only recovers persisted results or
// closes reservations which can no longer be claimed, under the normal finisher lock.
export async function inspectInterruptedTasks(pool,{projectId=null,read=readFile,finish=finishReceivedTask}={})
{
    const rows=(await pool.query(`SELECT p.*,e.state execution_state,r.state process_state,
        j.expires_at<now() expired,e.started_at<now()-interval '2 minutes' stale
        FROM gameai.task_publications p JOIN gameai.executions e ON e.id=p.execution_id
        JOIN gameai.task_dispatch_jobs j ON j.execution_id=e.id
        LEFT JOIN gameai.agent_runs r ON r.execution_id=replace(e.id::text,'-','')
        WHERE e.state IN ('assigned','running','unknown') AND p.response IS NULL
        AND ($1::uuid IS NULL OR e.project_id=$1)
        AND ((r.state IN ('completed','failed') AND r.finished_at<now()-interval '30 seconds') OR
            (r.state IS NULL AND j.expires_at<now()) OR
            (r.state IN ('running','unknown') AND j.expires_at<now())) ORDER BY e.started_at LIMIT 50`,[projectId])).rows;
    for (const row of rows)
    {
        if (!row.stale)
        {
            continue;
        }
        let result;
        try
        {
            result=JSON.parse(await read(join(tempRoot,'task-jobs',row.execution_id,'result.json'),'utf8'));
        }
        catch (error)
        {
            if (error.code!=='ENOENT')
            {
                await reportInterruption(pool,row,'result_unreadable','执行结果不可读取，需要恢复原文件：'+error.message);
                continue;
            }
        }
        const terminal=['completed','failed'].includes(row.process_state);
        const unclaimed=row.expired && !row.process_state;
        if (!terminal && !unclaimed)
        {
            await reportInterruption(pool,row,'process_unconfirmed','执行租约过期但原进程停止尚未确认；保留容量，等待停止凭据');
            continue;
        }
        const response=result ? {result,error:null,failure:null} : {
            result:null,error:unclaimed ? '派发租约已过期且没有 Agent claim；重新核验原任务后继续' : '原 Agent 已确认停止但未保存可发布结果；复用检查点修复并继续',
            failure:unclaimed ? {code:'HOST_RESERVATION_EXPIRED',pre_execution:true,items:[]} : {code:'TOOL_FAILURE',items:[]}
        };
        await saveTaskResponse(pool,row.job,response);
        await publishTaskResponse(pool,row.job,response,finish);
    }
    // A ready recovery permit is durable. If its notification was lost, the normal
    // task lane still sees active flows; recreate a notification without invoking Agents here.
    await pool.query(`INSERT INTO gameai.workflow_outbox(event_key,plan_version_id)
        SELECT 'repair-watchdog:'||r.execution_id::text,r.plan_version_id FROM gameai.task_repairs r
        JOIN gameai.plan_dispatch_flows f ON f.plan_version_id=r.plan_version_id
        WHERE r.state='ready' AND f.state='active' AND ($1::uuid IS NULL OR r.project_id=$1)
        ON CONFLICT DO NOTHING`,[projectId]);
}

async function reportInterruption(pool,row,code,reason)
{
    await pool.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload)
        SELECT $1,'orchestrator','巡检发现执行中断',$2::jsonb WHERE NOT EXISTS(
            SELECT 1 FROM gameai.audit_events WHERE project_id=$1 AND event='巡检发现执行中断'
            AND payload->>'execution_id'=$3 AND payload->>'code'=$4)`,
    [row.job.projectId,{execution_id:row.execution_id,task_id:row.job.taskId,code,reason},row.execution_id,code]);
}
