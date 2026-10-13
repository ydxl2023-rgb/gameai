import { ReviewError } from './requirements.js';

// Project-scoped reset preserves immutable audit history and configuration.
export async function clearProjectTasks(pool, projectKey, userId)
{
    const c = await pool.connect();
    try
    {
        await c.query('BEGIN');
        const project = (await c.query('SELECT id FROM gameai.projects WHERE project_key=$1', [projectKey])).rows[0];
        if (!project) throw new ReviewError('项目不存在。');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [project.id]);
        const permission = await c.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
            JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code
            WHERE u.id=$1 AND u.enabled AND ur.project_id=$2 AND rp.permission_code='requirement.approve'`, [userId, project.id]);
        if (!permission.rowCount) throw new ReviewError('请先登录有审批权限的人工账户。');
        const active = await c.query(`SELECT 1 WHERE
            EXISTS(SELECT 1 FROM gameai.requirement_revisions WHERE project_id=$1 AND state IN ('queued','running','unknown')) OR
            EXISTS(SELECT 1 FROM gameai.executions WHERE project_id=$1 AND state IN ('assigned','running','unknown')) OR
            EXISTS(SELECT 1 FROM gameai.pm_jobs WHERE project_id=$1 AND state IN ('running','unknown')) OR
            EXISTS(SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id
                WHERE s.project_id=$1 AND r.state IN ('running','unknown')) OR
            EXISTS(SELECT 1 FROM gameai.approval_workflows WHERE project_id=$1 AND state IN ('queued','pm'))`, [project.id]);
        if (active.rowCount) throw new ReviewError('仍有执行中、排队中或状态未明的任务，请先结束并核实执行后再清空。');
        // Deleting workflow intents prevents restart recovery from recreating the cleared tasks.
        // Explicit ordering avoids CASCADE reaching configuration.
        for (const table of ['requirement_revisions','approval_workflows','plan_dispatch_flows','task_edits','qa_defects','task_leases','task_dispatch_jobs','comments','task_dependencies'])
        {
            await c.query(`DELETE FROM gameai.${table} WHERE project_id=$1`, [project.id]);
        }
        await c.query('DELETE FROM gameai.artifact_links WHERE project_id=$1 AND task_id IS NOT NULL', [project.id]);
        await c.query('DELETE FROM gameai.executions WHERE project_id=$1', [project.id]);
        const deleted = await c.query('DELETE FROM gameai.tasks WHERE project_id=$1', [project.id]);
        await c.query('DELETE FROM gameai.pm_jobs WHERE project_id=$1', [project.id]);
        await c.query('DELETE FROM gameai.plan_versions WHERE project_id=$1', [project.id]);
        await c.query('DELETE FROM gameai.plans WHERE project_id=$1', [project.id]);
        const requirements = (await c.query('SELECT gameai.clear_project_requirements($1,$2) AS removed', [project.id,userId])).rows[0].removed;
        await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload)
            VALUES($1,$2,'tasks.cleared',$3)`, [project.id, 'human:'+userId, JSON.stringify({task_count:deleted.rowCount,requirement_count:requirements})]);
        await c.query('COMMIT');
        return { cleared:deleted.rowCount, requirements };
    }
    catch (error)
    {
        await c.query('ROLLBACK');
        throw error;
    }
    finally
    {
        c.release();
    }
}
