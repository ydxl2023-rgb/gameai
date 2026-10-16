import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createPool} from '../src/database/connection.js';
import {publishPmPlan} from '../src/database/pm-plans.js';
import {tempRoot} from '../src/paths.js';

// Reuse the saved validated result; never invoke an Agent or manufacture a completion record.
const executionId=process.argv[2];
if (!/^[0-9a-f]{32}$/.test(executionId ?? '')) throw new Error('Provide the original PM execution ID');
const pool=createPool();
try
{
    const job=(await pool.query('SELECT j.*,p.project_key FROM gameai.pm_jobs j JOIN gameai.projects p ON p.id=j.project_id WHERE execution_id=$1',[executionId])).rows[0];
    if (!job) throw new Error('PM job not found');
    const result=JSON.parse(await readFile(join(tempRoot,'pm-jobs',executionId,'result.json'),'utf8'));
    const published=await publishPmPlan(pool,job.project_key,job,result,{recoverPublication:true});
    console.log(JSON.stringify({state:published.state,plan_version_id:published.plan_version_id,task_count:published.task_count}));
}
finally
{
    await pool.end();
}
