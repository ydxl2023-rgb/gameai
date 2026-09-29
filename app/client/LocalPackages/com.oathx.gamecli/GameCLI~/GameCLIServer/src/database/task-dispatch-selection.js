import { z } from 'zod';
import { ReviewError } from './requirements.js';

const schema = z.object({ task_id:z.uuid(), allowed:z.boolean(), revision:z.number().int().nonnegative() }).strict();

// Human intent is persisted separately from task execution and dependency readiness.
export async function setTaskDispatchSelection(pool, projectKey, userId, raw)
{
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
    {
        throw new ReviewError('任务勾选参数无效。');
    }
    const input = parsed.data;
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        const project = (await client.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if (!project)
        {
            throw new ReviewError('项目不存在。');
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[project.id]);
        const permission = await client.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
            JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code WHERE u.id=$1 AND u.enabled AND ur.project_id=$2
            AND rp.permission_code='requirement.approve'`,[userId,project.id]);
        if (!permission.rowCount)
        {
            throw new ReviewError('请由已登录且有审批权限的人工账户选择允许派发的任务。');
        }
        const task = (await client.query('SELECT * FROM gameai.tasks WHERE id=$1 AND project_id=$2 FOR UPDATE',[input.task_id,project.id])).rows[0];
        if (!task?.parent_id || task.role_code === 'PM')
        {
            throw new ReviewError('只能勾选当前项目的专业子任务。');
        }
        const active = await client.query("SELECT 1 FROM gameai.executions WHERE task_id=$1 AND state IN ('assigned','running','unknown')",[task.id]);
        if (!['pending','blocked'].includes(task.status) || active.rowCount)
        {
            throw new ReviewError('该任务已派发、执行或结束，不能通过勾选框修改；取消执行需单独处理。');
        }
        if (input.allowed)
        {
            const approved = await client.query(`SELECT 1 FROM gameai.plan_versions p JOIN gameai.requirement_versions v ON v.id=p.requirement_version_id
                JOIN gameai.approvals a ON a.version_id=v.id AND a.decision='approved'
                WHERE p.id=$1 AND p.state='published' AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions newer
                    WHERE newer.requirement_id=v.requirement_id AND newer.ordinal>v.ordinal)`,[task.plan_version_id]);
            if (!approved.rowCount)
            {
                throw new ReviewError('只能允许最新已批准需求的已发布计划任务派发。');
            }
        }
        if (task.dispatch_revision !== input.revision)
        {
            if (task.dispatch_revision !== input.revision+1 || task.dispatch_allowed !== input.allowed || task.dispatch_selected_by !== userId)
            {
                throw new ReviewError('任务选择已被修改，请刷新后重试。');
            }
        }
        else if (task.dispatch_allowed !== input.allowed)
        {
            await client.query(`UPDATE gameai.tasks SET dispatch_allowed=$2,dispatch_revision=dispatch_revision+1,
                dispatch_selected_by=$3,dispatch_selected_at=now() WHERE id=$1`,[task.id,input.allowed,userId]);
            await client.query('INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,$3,$4)',
                [project.id,'human:'+userId,input.allowed ? '人工允许子任务派发' : '人工撤回子任务派发许可',
                    {task_id:task.id,task_key:task.task_key,allowed:input.allowed,revision:task.dispatch_revision+1}]);
        }
        const result = (await client.query('SELECT dispatch_allowed,dispatch_revision FROM gameai.tasks WHERE id=$1',[task.id])).rows[0];
        await client.query('COMMIT');
        return result;
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        throw error;
    }
    finally
    {
        client.release();
    }
}
