import {createPool} from '../src/database/connection.js';
import {setTaskDispatchSelection} from '../src/database/task-dispatch-selection.js';
import {dispatchTasks} from '../src/database/task-dispatch.js';
import {runTaskDispatch} from '../src/track/task-dispatch.js';
import {acceptTask} from '../src/database/task-acceptance.js';

// Explicit, single-task server maintenance; never creates a plan or a replacement task.
const [taskKey,subject]=process.argv.slice(2);
const pool=createPool();
try
{
    const task=(await pool.query(`SELECT t.*,p.project_key FROM gameai.tasks t JOIN gameai.projects p ON p.id=t.project_id WHERE t.task_key=$1`,[taskKey])).rows[0];
    const user=(await pool.query('SELECT id FROM gameai.users WHERE subject=$1 AND enabled',[subject])).rows[0];
    if (!task || !user) throw new Error('Task and human required');
    const amendment=await pool.query("SELECT 1 FROM gameai.task_edits WHERE task_id=$1 AND field='production-amendment'",[task.id]);
    if (!amendment.rowCount) throw new Error('Authorize a reviewed amendment first');
    if (task.status==='completed') {console.log(JSON.stringify({task:taskKey,status:'completed',repeated:true}));}
    else
    {
        if (!task.dispatch_allowed) await setTaskDispatchSelection(pool,task.project_key,user.id,{task_id:task.id,allowed:true,revision:task.dispatch_revision});
        const current=(await pool.query('SELECT dispatch_revision FROM gameai.tasks WHERE id=$1',[task.id])).rows[0];
        const attempts=(await pool.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[task.id])).rows[0].n;
        const request={tasks:[{task_id:task.id,revision:current.dispatch_revision}],retry:true,recovery_cycle:true,
            ...(attempts>=3 ? {retry_override:{attempts,reason:'用户明确要求继续原任务直至完成；已登记最小修复契约增补，复核现有修复与全部证据。'}} : {})};
        const preview=await dispatchTasks(pool,task.project_key,user.id,request);
        if (!preview.rows[0]?.ready) throw new Error(preview.rows[0]?.reason ?? 'Not dispatchable');
        const result=await dispatchTasks(pool,task.project_key,user.id,request,true);
        if (result.jobs.length!==1) throw new Error('Single task dispatch required');
        console.log(JSON.stringify({task:taskKey,execution:result.jobs[0].executionId,state:'dispatched'}));
        await runTaskDispatch(pool,result.jobs[0]);
        const finished=(await pool.query('SELECT status FROM gameai.tasks WHERE id=$1',[task.id])).rows[0];
        if (finished.status==='review') await acceptTask(pool,task.project_key,user.id,{task_id:task.id});
        const final=(await pool.query('SELECT status,progress FROM gameai.tasks WHERE id=$1',[task.id])).rows[0];
        console.log(JSON.stringify({task:taskKey,...final}));
        if (final.status!=='completed') process.exitCode=2;
    }
}
finally {await pool.end();}
