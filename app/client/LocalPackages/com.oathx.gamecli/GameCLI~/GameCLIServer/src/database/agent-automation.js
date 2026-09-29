import {z} from 'zod';
import {ReviewError} from './requirements.js';

export async function setAgentAutomation(pool,projectKey,userId,raw)
{
    const parsed=z.object({agent:z.string().min(1).max(100),enabled:z.boolean(),revision:z.number().int().nonnegative()}).strict().safeParse(raw);
    if(!parsed.success) throw new ReviewError('自动执行设置无效。');
    const input=parsed.data;
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const project=(await c.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if(!project) throw new ReviewError('项目不存在。');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[project.id]);
        const permission=await c.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code
            WHERE u.id=$1 AND u.enabled AND ur.project_id=$2 AND rp.permission_code='requirement.approve'`,[userId,project.id]);
        if(!permission.rowCount) throw new ReviewError('需要人工审批权限才能配置自动执行。');
        const agent=(await c.query('SELECT a.* FROM gameai.agents a JOIN gameai.fixed_agents f ON f.agent_id=a.id WHERE a.project_id=$1 AND a.agent_key=$2',[project.id,input.agent])).rows[0];
        if(!agent || !['PM','Art','Development','QA'].includes(agent.role_code)) throw new ReviewError('仅固定 PM、美术、开发和 QA 支持此流程自动执行。');
        if(agent.automation_revision!==input.revision) throw new ReviewError('设置已改变，请刷新后重试。');
        if(input.enabled && !agent.enabled) throw new ReviewError('请先启用 Agent。');
        const updated=(await c.query('UPDATE gameai.agents SET auto_execute=$2,automation_revision=automation_revision+1 WHERE id=$1 RETURNING auto_execute,automation_revision',[agent.id,input.enabled])).rows[0];
        await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,$3,$4)",[project.id,'human:'+userId,input.enabled?'开启 Agent 自动执行':'关闭 Agent 自动执行',{agent:agent.agent_key}]);
        await c.query('COMMIT');return updated;
    }
    catch(error){await c.query('ROLLBACK');throw error;}
    finally {c.release();}
}

export async function readAutomationPolicy(c,projectId)
{
    return (await c.query(`SELECT a.id,a.role_code FROM gameai.fixed_agents f JOIN gameai.agents a ON a.id=f.agent_id
        WHERE f.project_id=$1 AND a.enabled AND a.auto_execute AND a.role_code IN ('PM','Art','Development','QA') ORDER BY a.role_code`,[projectId])).rows;
}
