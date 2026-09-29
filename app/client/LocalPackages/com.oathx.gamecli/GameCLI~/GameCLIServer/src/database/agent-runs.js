import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ReviewError } from './requirements.js';

const roles = z.enum(['Design','PM','Art','Development','QA']);
const claim = z.object({ action:z.literal('claim'), execution_id:z.string().regex(/^[a-f0-9]{32}$/), role:roles,
    requirement_key:z.string().regex(/^[A-Z][A-Z0-9_-]{1,79}$/), worker_key:z.string().min(1).max(100), input_hash:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const update = z.object({ action:z.enum(['heartbeat','attach','finish']), execution_id:z.string().regex(/^[a-f0-9]{32}$/),
    worker_key:z.string().min(1).max(100), thread_id:z.string().min(1).max(100).optional(),
    state:z.enum(['completed','failed']).optional(), error:z.string().max(1000).optional() }).strict();

export async function agentRunRequest(pool, projectKey, raw)
{
    const parsed = (raw?.action === 'claim' ? claim : update).safeParse(raw);
    if (!parsed.success)
    {
        throw new ReviewError('固定 Agent 请求字段无效。');
    }
    const input = parsed.data;
    const c = await pool.connect();
    try
    {
        await c.query('BEGIN');
        const project = (await c.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if (!project)
        {
            throw new ReviewError('项目不存在。');
        }
        // One lock serializes role assignment, worker capacity and conversation ownership.
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[project.id]);
        const worker = (await c.query('SELECT * FROM gameai.workers WHERE project_id=$1 AND worker_key=$2 AND enabled',[project.id,input.worker_key])).rows[0];
        if (!worker)
        {
            throw new ReviewError('执行节点未配置或已停用。');
        }
        await c.query(`UPDATE gameai.agent_runs r SET state='unknown',error='执行心跳超时，需核实原进程后恢复'
            FROM gameai.agent_conversations s WHERE r.conversation_id=s.id AND s.project_id=$1 AND r.state='running' AND r.expires_at<=now()`,[project.id]);
        let result;
        if (input.action === 'claim')
        {
            const agent = (await c.query(`SELECT a.* FROM gameai.fixed_agents f JOIN gameai.agents a ON a.id=f.agent_id
                WHERE f.project_id=$1 AND f.role_code=$2 AND a.role_code=$2 AND a.enabled AND a.worker_id=$3`,[project.id,input.role,worker.id])).rows[0];
            if (!agent)
            {
                throw new ReviewError('该角色没有当前节点可用的固定 Agent。');
            }
            const skills = (await c.query(`SELECT s.skill_key,s.content_hash,s.role_code,s.enabled,g.is_primary FROM gameai.agent_skills g JOIN gameai.skills s ON s.skill_key=g.skill_key
                WHERE g.agent_id=$1 ORDER BY g.is_primary DESC,s.skill_key`,[agent.id])).rows;
            if (skills.some(s => !s.enabled))
            {
                throw new ReviewError('固定 Agent 使用的技能已停用。');
            }
            if (!skills.some(s => s.is_primary && s.role_code === input.role))
            {
                throw new ReviewError('固定 Agent 缺少对应角色主技能。');
            }
            const instructions = [];
            for (const skill of skills)
            {
                const bytes = await readFile(new URL('../../../../game-cli/'+skill.skill_key+'/SKILL.md',import.meta.url));
                if (createHash('sha256').update(bytes).digest('hex') !== skill.content_hash)
                {
                    throw new ReviewError('技能已改变，请先同步技能目录。');
                }
                instructions.push(bytes.toString('utf8'));
            }
            const session = (await c.query(`INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id)
                VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,requirement_key,role_code) DO UPDATE SET requirement_key=EXCLUDED.requirement_key RETURNING *`,
                [project.id,input.requirement_key,input.role,agent.id,worker.id])).rows[0];
            if (session.agent_id !== agent.id || session.worker_id !== worker.id)
            {
                throw new ReviewError('原会话绑定其他 Agent 或节点，不能静默转交。');
            }
            const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
            const previous = (await c.query('SELECT * FROM gameai.agent_runs WHERE execution_id=$1',[input.execution_id])).rows[0];
            if (previous)
            {
                if (previous.conversation_id !== session.id || previous.request_hash !== requestHash || previous.state !== 'running')
                {
                    throw new ReviewError('执行编号已使用或已失效。');
                }
            }
            else
            {
                const used = (await c.query(`SELECT count(*)::int total,count(*) FILTER(WHERE s.agent_id=$2)::int agent_used
                    FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id
                    WHERE s.worker_id=$1 AND r.state IN ('running','unknown')`,[worker.id,agent.id])).rows[0];
                const tasks = (await c.query(`SELECT count(*)::int total,count(*) FILTER(WHERE e.agent_id=$2)::int agent_used
                    FROM gameai.executions e JOIN gameai.agents a ON a.id=e.agent_id
                    WHERE a.worker_id=$1 AND e.state IN ('assigned','running','unknown')`,[worker.id,agent.id])).rows[0];
                if (used.total + tasks.total >= worker.capacity || used.agent_used + tasks.agent_used >= 1)
                {
                    throw new ReviewError('固定 Agent 或节点忙碌；状态未知的执行必须先核实。');
                }
                await c.query('INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state) VALUES($1,$2,$3,\'running\')',[input.execution_id,session.id,requestHash]);
                await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'固定 Agent 开始执行',$3)`,[project.id,agent.agent_key,{execution_id:input.execution_id,requirement_key:input.requirement_key}]);
            }
            result = { agent_key:agent.agent_key, conversation_id:session.id, thread_id:session.thread_id, instructions:instructions.join('\n\n') };
        }
        else
        {
            const run = (await c.query(`SELECT r.*,s.thread_id,s.project_id,s.worker_id FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id
                WHERE r.execution_id=$1 AND s.project_id=$2 AND s.worker_id=$3 FOR UPDATE OF r`,[input.execution_id,project.id,worker.id])).rows[0];
            if (!run)
            {
                throw new ReviewError('执行不存在或不属于当前节点。');
            }
            if (input.action === 'finish' && run.state === input.state)
            {
                result = { state:run.state };
            }
            else
            {
                if (run.state !== 'running' || new Date(run.expires_at).getTime() <= Date.now())
                {
                    throw new ReviewError('执行授权已失效，不接受迟到结果。');
                }
                if (input.action === 'attach')
                {
                    if (!input.thread_id || (run.thread_id && run.thread_id !== input.thread_id))
                    {
                        throw new ReviewError('禁止替换已有会话。');
                    }
                    await c.query('UPDATE gameai.agent_conversations SET thread_id=$1 WHERE id=$2',[input.thread_id,run.conversation_id]);
                }
                if (input.action === 'finish')
                {
                    if (!input.state || (input.state === 'completed' && !run.thread_id))
                    {
                        throw new ReviewError('执行结束状态或会话缺失。');
                    }
                    await c.query('UPDATE gameai.agent_runs SET state=$1,finished_at=now(),error=$2 WHERE execution_id=$3',[input.state,input.error ?? '',input.execution_id]);
                    await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,$3,$4)`,
                        [project.id,input.worker_key,input.state === 'completed' ? '固定 Agent 执行完成' : '固定 Agent 执行失败',{ execution_id:input.execution_id }]);
                }
                else
                {
                    await c.query("UPDATE gameai.agent_runs SET expires_at=now()+interval '90 seconds' WHERE execution_id=$1",[input.execution_id]);
                }
                result = { state:input.state ?? 'running' };
            }
        }
        await c.query('UPDATE gameai.workers SET last_heartbeat_at=now() WHERE id=$1',[worker.id]);
        await c.query('COMMIT');
        return result;
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
