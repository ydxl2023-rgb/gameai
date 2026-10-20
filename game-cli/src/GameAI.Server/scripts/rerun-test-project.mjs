import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot} from '../src/paths.js';
import {createPool} from '../src/database/connection.js';
import {clearProjectTasks} from '../src/database/task-clear.js';
import {startPmJob} from '../src/database/pm-plans.js';
import {dispatchPmJob} from '../src/track/pm-dispatch.js';
import {readTaskInput} from '../src/database/ui-task-plans.js';
import {authorizeTaskAmendment} from '../src/database/task-amendments.js';
import {setTaskDispatchSelection} from '../src/database/task-dispatch-selection.js';
import {dispatchTasks} from '../src/database/task-dispatch.js';
import {runTaskChain} from '../src/track/task-flow.js';
import {acceptTask} from '../src/database/task-acceptance.js';

// Explicit reset/rerun of a named test project using server-owned workflow operations.
const [projectKey,requirementKey,subject]=process.argv.slice(2);
const pool=createPool();
try
{
    const project=(await pool.query('SELECT * FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
    const user=(await pool.query('SELECT id FROM gameai.users WHERE subject=$1 AND enabled',[subject])).rows[0];
    if (!project?.is_test || !user) throw new Error('An explicitly named test project and enabled human are required');
    const version=(await pool.query(`SELECT v.*,a.sha256 document_hash FROM gameai.requirements r JOIN gameai.requirement_versions v ON v.requirement_id=r.id
        JOIN gameai.approvals approval ON approval.version_id=v.id AND approval.decision='approved'
        JOIN gameai.artifact_links l ON l.requirement_version_id=v.id JOIN gameai.artifacts a ON a.id=l.artifact_id AND a.media_type='text/html'
        WHERE r.project_id=$1 AND r.requirement_key=$2 AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions n WHERE n.requirement_id=r.id AND n.ordinal>v.ordinal)`,[project.id,requirementKey])).rows[0];
    if (!version) throw new Error('Latest approved requirement required');
    const amendments=(await pool.query(`SELECT e.after_value,t.window_id FROM gameai.task_edits e JOIN gameai.tasks t ON t.id=e.task_id
        JOIN gameai.plan_versions p ON p.id=t.plan_version_id WHERE t.project_id=$1 AND p.requirement_version_id=$2 AND e.field='production-amendment' ORDER BY e.created_at`,[project.id,version.id])).rows;
    if (amendments.length>1) throw new Error('Review multiple amendments before rerunning');
    const evidence=join(projectRoot,'deliveries','rerun-'+Date.now());
    await mkdir(evidence,{recursive:true});
    // Evidence only: PostgreSQL remains authoritative for all workflow decisions.
    await writeFile(join(evidence,'preserved-authorization.json'),JSON.stringify({projectKey,requirementKey,versionId:version.id,amendments},null,2));
    console.log(JSON.stringify({reset:await clearProjectTasks(pool,projectKey,user.id,{preserveRequirements:true,clearCollaboration:true}),preservedRequirement:requirementKey}));
    const started=await startPmJob(pool,projectKey,user.id,{version_id:version.id,revision:version.content_hash,document_hash:version.document_hash});
    if (!started.created) throw new Error('Fresh PM execution was not created');
    console.log(JSON.stringify({phase:'PM',execution:started.job.execution_id}));
    await dispatchPmJob(pool,projectKey,started);
    const pm=(await pool.query('SELECT state,error FROM gameai.pm_jobs WHERE id=$1',[started.job.id])).rows[0];
    if (pm.state!=='completed') throw new Error('PM did not complete: '+JSON.stringify(pm));
    const tasks=(await pool.query(`SELECT t.* FROM gameai.tasks t JOIN gameai.plan_versions p ON p.id=t.plan_version_id WHERE t.project_id=$1 AND p.requirement_version_id=$2 AND t.parent_id IS NOT NULL ORDER BY t.task_key`,[project.id,version.id])).rows;
    if (!tasks.length) throw new Error('No new specialist tasks');
    for (const prior of amendments)
    {
        const task=tasks.find(t=>t.delivery_phase==='assembly' && t.window_id===prior.window_id);
        if (!task) throw new Error('Matching assembly task missing');
        const input=await readTaskInput(pool,task.id);
        await authorizeTaskAmendment(pool,task.id,user.id,{...prior.after_value,baseHash:input.sha256,
            authorizationReference:prior.after_value.authorizationReference+'；用户随后明确要求清空测试数据并按已修复规格重新跑一次。'});
    }
    for (const task of tasks)
    {
        const current=(await pool.query('SELECT dispatch_revision FROM gameai.tasks WHERE id=$1',[task.id])).rows[0];
        await setTaskDispatchSelection(pool,projectKey,user.id,{task_id:task.id,allowed:true,revision:current.dispatch_revision});
    }
    const current=(await pool.query('SELECT id task_id,dispatch_revision revision FROM gameai.tasks WHERE plan_version_id=$1 AND parent_id IS NOT NULL ORDER BY task_key',[tasks[0].plan_version_id])).rows;
    const dispatch=await dispatchTasks(pool,projectKey,user.id,{tasks:current,auto_continue:true},true);
    if (dispatch.jobs.length!==1) throw new Error('Initial task did not dispatch');
    console.log(JSON.stringify({phase:'specialists',tasks:tasks.map(t=>({task:t.task_key,phase:t.delivery_phase})),execution:dispatch.jobs[0].executionId}));
    await runTaskChain(pool,dispatch.jobs[0]);
    const final=(await pool.query('SELECT id,task_key,status FROM gameai.tasks WHERE plan_version_id=$1 AND parent_id IS NOT NULL ORDER BY task_key',[tasks[0].plan_version_id])).rows;
    for (const task of final)
    {
        if (task.status==='review') await acceptTask(pool,projectKey,user.id,{task_id:task.id});
    }
    const status=(await pool.query('SELECT task_key,status,progress FROM gameai.tasks WHERE plan_version_id=$1 ORDER BY task_key',[tasks[0].plan_version_id])).rows;
    console.log(JSON.stringify({phase:'finished',tasks:status}));
    if (status.some(t=>t.status!=='completed')) process.exitCode=2;
}
finally {await pool.end();}
