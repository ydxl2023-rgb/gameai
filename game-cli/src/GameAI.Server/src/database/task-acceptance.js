import {z} from 'zod';
import {ReviewError} from './requirements.js';
import {effectiveDelivery} from './qa-context.js';
import {verifyTaskFiles} from './task-files.js';

export async function acceptTask(pool,projectKey,userId,raw)
{
    const parsed=z.object({task_id:z.uuid()}).strict().safeParse(raw);
    if (!parsed.success) throw new ReviewError('验收参数无效');
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const project=(await c.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if (!project) throw new ReviewError('项目不存在');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[project.id]);
        const permission=await c.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code WHERE u.id=$1 AND u.enabled AND ur.project_id=$2 AND rp.permission_code='requirement.approve'`,[userId,project.id]);
        if (!permission.rowCount) throw new ReviewError('需要人工审批权限');
        const t=(await c.query('SELECT * FROM gameai.tasks WHERE id=$1 AND project_id=$2 FOR UPDATE',[parsed.data.task_id,project.id])).rows[0];
        if (!t?.parent_id || t.role_code==='PM') throw new ReviewError('仅支持具体交付任务验收');
        if (t.status==='completed') {await c.query('COMMIT');return {accepted:true,repeated:true};}
        if (t.status!=='review') throw new ReviewError('任务不是待验收状态，请刷新');
        const current=await c.query(`SELECT 1 FROM gameai.plan_versions p JOIN gameai.requirement_versions v ON v.id=p.requirement_version_id JOIN gameai.approvals a ON a.version_id=v.id AND a.decision='approved' WHERE p.id=$1 AND p.state='published' AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions n WHERE n.requirement_id=v.requirement_id AND n.ordinal>v.ordinal)`,[t.plan_version_id]);
        if (!current.rowCount) throw new ReviewError('需求未批准或计划已经过期');
        const defects=await c.query("SELECT 1 FROM gameai.qa_defects WHERE (qa_task_id=$1 OR source_task_id=$1 OR repair_task_id=$1) AND state<>'closed'",[t.id]);
        if (defects.rowCount) throw new ReviewError('存在未关闭的 QA 缺陷，需要先修复复测');
        const delivery=await effectiveDelivery(c,t.id);
        if (!delivery.execution_id || !delivery.artifacts.length || !await verifyTaskFiles(delivery.artifacts)) throw new ReviewError('交付文件缺失或已变化，不能验收');
        await c.query("UPDATE gameai.tasks SET status='completed',progress=100 WHERE id=$1",[t.id]);
        await c.query(`UPDATE gameai.tasks parent SET progress=s.progress,status=CASE WHEN s.finished THEN 'completed' ELSE 'running' END FROM (SELECT round(100.0*count(*) FILTER(WHERE status='completed')/count(*))::int progress,bool_and(status='completed') finished FROM gameai.tasks WHERE parent_id=$1) s WHERE parent.id=$1`,[t.parent_id]);
        // Persist continuation intent before notifying the scheduler; permissions are checked again at dispatch.
        await c.query(`INSERT INTO gameai.plan_dispatch_flows(plan_version_id,project_id,requested_by,state) VALUES($1,$2,$3,'active') ON CONFLICT(plan_version_id) DO UPDATE SET state='active',reason='',updated_at=now()`,[t.plan_version_id,project.id,userId]);
        await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'人工验收通过，通知后续任务',$3)`,[project.id,'human:'+userId,{task_id:t.id,execution_id:delivery.execution_id,summary:'交付验收完成；编排器按依赖、勾选及 Agent 自动授权检查后续任务。'}]);
        await c.query('COMMIT');
        return {accepted:true,repeated:false};
    }
    catch(error) {await c.query('ROLLBACK');throw error;}
    finally {c.release();}
}
