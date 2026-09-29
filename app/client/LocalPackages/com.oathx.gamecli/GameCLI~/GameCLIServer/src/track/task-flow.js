import {dispatchTasks} from '../database/task-dispatch.js';
import {runTaskDispatch} from './task-dispatch.js';

// Completion-driven scheduling; the persisted flow supplies scope and the original human authorization.
export async function continueTaskFlow(pool,planVersionId,execute)
{
    while (true)
    {
        const flow=(await pool.query(`SELECT f.*,p.project_key FROM gameai.plan_dispatch_flows f JOIN gameai.projects p ON p.id=f.project_id WHERE f.plan_version_id=$1 AND f.state='active'`,[planVersionId])).rows[0];
        if (!flow) return;
        const tasks=(await pool.query(`SELECT id task_id,dispatch_revision revision FROM gameai.tasks WHERE plan_version_id=$1 AND dispatch_allowed AND status IN ('pending','blocked') ORDER BY CASE WHEN EXISTS(SELECT 1 FROM gameai.qa_defects d WHERE d.repair_task_id=tasks.id) THEN 0 WHEN role_code='QA' THEN 1 WHEN role_code='Art' THEN 2 ELSE 3 END,task_key`,[planVersionId])).rows;
        if (!tasks.length)
        {
            await pool.query(`UPDATE gameai.plan_dispatch_flows f SET state='completed',reason='已授权任务执行结束，待验收项仍需人工验收',updated_at=now() WHERE plan_version_id=$1 AND state='active' AND NOT EXISTS(SELECT 1 FROM gameai.tasks t WHERE t.plan_version_id=f.plan_version_id AND t.dispatch_allowed AND t.status IN ('pending','blocked','running','failed'))`,[planVersionId]);
            return;
        }
        let next;
        try {next=await dispatchTasks(pool,flow.project_key,flow.requested_by,{tasks:tasks.slice(0,100)},true);}
        catch(error)
        {
            await pool.query("UPDATE gameai.plan_dispatch_flows SET state='paused',reason=$2,updated_at=now() WHERE plan_version_id=$1",[planVersionId,error.message]);
            return;
        }
        if (!next.jobs.length)
        {
            await pool.query("UPDATE gameai.plan_dispatch_flows SET reason=$2,updated_at=now() WHERE plan_version_id=$1 AND state='active'",[planVersionId,next.rows.map(r=>r.id+'：'+r.reason).join('；').slice(0,4000)]);
            return;
        }
        await runTaskDispatch(pool,next.jobs[0],execute);
    }
}
export async function runTaskChain(pool,job,execute)
{
    await runTaskDispatch(pool,job,execute);
    await resumeTaskFlows(pool,execute);
}
export async function resumeTaskFlows(pool,execute)
{
    const flows=(await pool.query("SELECT plan_version_id FROM gameai.plan_dispatch_flows WHERE state='active' ORDER BY updated_at")).rows;
    for (const flow of flows) await continueTaskFlow(pool,flow.plan_version_id,execute);
}
