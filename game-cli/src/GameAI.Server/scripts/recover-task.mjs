import {createPool} from '../src/database/connection.js';
import {enqueueTaskRepair,repairScopeHash} from '../src/database/task-repairs.js';
import {readTaskInput} from '../src/database/ui-task-plans.js';
import {recoveryDecision,recoveryAttempts} from '../src/database/task-recovery.js';
import {resumeTaskRepairs} from '../src/track/task-repair-flow.js';
import {continueTaskFlow} from '../src/track/task-flow.js';

const key=process.argv[2];
if (!/^[A-Z]-\d+$/.test(key ?? '')) throw new Error('Provide an existing task key.');
const pool=createPool();
const c=await pool.connect();
let task;
try
{
    await c.query('BEGIN');
    task=(await c.query(`SELECT t.*,e.id execution_id,e.state execution_state,e.result,j.context,j.input_hash,f.agent_policy,f.reason flow_reason,
        (f.state='paused' AND a.auto_execute AND a.enabled AND t.dispatch_allowed) authorized,
        (SELECT count(*)::int FROM gameai.executions WHERE task_id=t.id) attempts
        FROM gameai.tasks t JOIN gameai.executions e ON e.task_id=t.id
        JOIN gameai.agents a ON a.id=e.agent_id JOIN gameai.plan_dispatch_flows f ON f.plan_version_id=t.plan_version_id
        LEFT JOIN gameai.task_dispatch_jobs j ON j.execution_id=e.id WHERE t.task_key=$1 ORDER BY e.started_at DESC LIMIT 1 FOR UPDATE OF t`,[key])).rows[0];
    if (!task || task.status!=='failed' || task.execution_state!=='failed' || !task.authorized) throw new Error('Task is not a confirmed failed task with the original automatic-execution permission.');
    if (task.flow_reason!==task.result?.recovery?.reason && !task.flow_reason.startsWith('自动恢复处理中：')) throw new Error('Flow was paused by another operation; refusing to override it.');
    const decision=recoveryDecision({state:task.execution_state,error:task.result?.error,failure:task.result?.failure,attempts:recoveryAttempts(task.attempts,task.context),authorized:true});
    const repairInput=repairScopeHash(task,task.context,(await readTaskInput(c,task.id))?.sha256);
    const queued=await enqueueTaskRepair(c,task,task.execution_id,decision,{error:task.result?.error,failure:task.result?.failure,context:{...task.context,input_hash:task.input_hash,repair_input_hash:repairInput},result:task.result?.result});
    await c.query(`UPDATE gameai.plan_dispatch_flows SET reason=$2 WHERE plan_version_id=$1`,[task.plan_version_id,'自动恢复处理中：'+queued.decision.reason]);
    await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','既有失败任务接入持久化恢复',$2)`,[task.project_id,{task_id:task.id,execution_id:task.execution_id}]);
    await c.query('COMMIT');
    console.log(JSON.stringify({task:key,repairState:queued.state,historyPreserved:true}));
    if (!process.argv.includes('--enqueue-only'))
    {
        await resumeTaskRepairs(pool,{projectId:task.project_id});
        await continueTaskFlow(pool,task.plan_version_id);
    }
}
catch(error)
{
    await c.query('ROLLBACK');
    throw error;
}
finally
{
    c.release();
    await pool.end();
}
