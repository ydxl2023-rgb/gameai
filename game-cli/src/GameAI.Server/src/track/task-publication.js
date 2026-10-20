import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tempRoot} from '../paths.js';

const active = new Set();
export const taskResultPath = id => join(tempRoot,'task-jobs',id,'received-result.json');

// This is an output spool, never an authority for task state or permission.
export async function saveTaskResponse(pool,job,response)
{
    const path = taskResultPath(job.executionId);
    await mkdir(join(tempRoot,'task-jobs',job.executionId),{recursive:true});
    await writeFile(path+'.tmp',JSON.stringify(response),'utf8');
    await rename(path+'.tmp',path);
    await pool.query(`UPDATE gameai.task_publications SET response=$2,state='ready',updated_at=now() WHERE execution_id=$1 AND state='executing'`,[job.executionId,response]);
}

// Only publication is retried; this function cannot invoke an Agent.
export async function publishTaskResponse(pool,job,response,finish)
{
    if (active.has(job.executionId)) return;
    active.add(job.executionId);
    try
    {
        await finish(pool,job,response);
        await pool.query(`UPDATE gameai.task_publications SET state='published',last_error='',updated_at=now() WHERE execution_id=$1`,[job.executionId]);
    }
    catch (error)
    {
        const changed=await pool.query(`UPDATE gameai.task_publications SET attempts=attempts+1,
            state=CASE WHEN attempts+1>=5 THEN 'attention' ELSE 'ready' END,
            last_error=$2,next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE execution_id=$1 RETURNING state`,[job.executionId,error.message]);
        if (changed.rows[0]?.state==='attention')
        {
            await recordPublicationAttention(pool,job,'publication_retry_exhausted',error.message);
        }
        throw error;
    }
    finally
    {
        active.delete(job.executionId);
    }
}

async function recordPublicationAttention(pool,job,code,error)
{
    await pool.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload)
        VALUES($1,'orchestrator','任务结果发布等待处理',$2)`,[job.projectId,{task_id:job.taskId,execution_id:job.executionId,code,error,summary:'已保留原执行结果；需要处理发布问题，不重新执行 Agent。'}]);
}

export async function recoverTaskPublications(pool,finish,read=readFile)
{
    const rows = (await pool.query(`SELECT p.*,e.state execution_state,r.state process_state FROM gameai.task_publications p
        JOIN gameai.executions e ON e.id=p.execution_id
        LEFT JOIN gameai.agent_runs r ON r.execution_id=replace(e.id::text,'-','')
        WHERE (p.state IN ('executing','ready') OR (e.state='unknown' AND r.state IN ('completed','failed')))
        AND p.next_attempt_at<=now() ORDER BY p.updated_at LIMIT 100`)).rows;
    for (const row of rows)
    {
        if (active.has(row.execution_id)) continue;
        // A transaction may have committed just before the server lost its connection.
        if (row.execution_state==='unknown' && !['completed','failed'].includes(row.process_state)) continue;
        if (!['assigned','running','unknown'].includes(row.execution_state))
        {
            await pool.query(`UPDATE gameai.task_publications SET state='published',updated_at=now() WHERE execution_id=$1`,[row.execution_id]);
            continue;
        }
        let response = row.response;
        if (!response)
        {
            try { response = JSON.parse(await read(taskResultPath(row.execution_id),'utf8')); }
            catch (error)
            {
                if (error.code === 'ENOENT') continue;
                await pool.query(`UPDATE gameai.task_publications SET state='attention',last_error=$2,updated_at=now() WHERE execution_id=$1`,[row.execution_id,'结果缓存不可读取：'+error.message]);
                await recordPublicationAttention(pool,row.job,'result_unreadable',error.message);
                continue;
            }
            await pool.query(`UPDATE gameai.task_publications SET response=$2,state='ready',updated_at=now() WHERE execution_id=$1 AND state='executing'`,[row.execution_id,response]);
        }
        try { await publishTaskResponse(pool,row.job,response,finish); }
        catch (error) { console.error('任务结果发布等待恢复',row.execution_id,error.message); }
    }
}
