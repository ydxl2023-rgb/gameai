import {createPool} from '../src/database/connection.js';
import {ensureQaTasks} from '../src/database/qa-context.js';

// Add missing QA coverage without restarting any paused plan or changing existing tasks.
const pool=createPool();
const c=await pool.connect();
try
{
    await c.query('BEGIN');
    const plans=(await c.query("SELECT id,project_id FROM gameai.plan_versions WHERE state='published' ORDER BY project_id,id")).rows;
    let count=0;
    for (const plan of plans)
    {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[plan.project_id]);
        const tasks=await ensureQaTasks(c,plan.id);
        if (tasks.length) await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','为现有计划补充 QA 交付验收',$2)",[plan.project_id,{plan_version_id:plan.id,task_ids:tasks}]);
        await c.query('UPDATE gameai.pm_jobs SET task_count=(SELECT count(*) FROM gameai.tasks WHERE plan_version_id=$1 AND parent_id IS NOT NULL) WHERE plan_version_id=$1',[plan.id]);
        count+=tasks.length;
    }
    await c.query('COMMIT');
    console.log('新增 QA 任务：'+count+'；保留现有流程开关与暂停原因。');
}
catch(error) {await c.query('ROLLBACK');throw error;}
finally {c.release();await pool.end();}
