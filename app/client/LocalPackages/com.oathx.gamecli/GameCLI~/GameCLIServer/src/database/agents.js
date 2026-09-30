import { createHash, randomUUID } from 'node:crypto';
import { discoverSkills, readSkill, isPrimarySkill, canUseExtraSkill, skillKeyPattern, skillRelocations } from './skill-catalog.js';
import { z } from 'zod';

const inputSchema = z.object({
    request_id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    role: z.enum(['Design', 'PM', 'Art', 'Development', 'QA']),
    worker_id: z.uuid(),
    primary_skill: z.string().min(1).max(100),
    extra_skills: z.array(z.string().min(1).max(100)).max(16),
    capacity: z.number().int().min(1).max(16),
    enabled: z.boolean()
}).strict();

export class AgentInputError extends Error {}

export async function syncSkillCatalog(pool)
{
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        // Match the claim/skill-edit lock before migrating active Agent bindings.
        for (const project of (await client.query('SELECT id FROM gameai.projects ORDER BY id')).rows)
        {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))', [project.id]);
        }
        const oldKeys = Object.keys(skillRelocations);
        const relocating = (await client.query('SELECT 1 FROM gameai.skills WHERE skill_key=ANY($1::text[]) LIMIT 1', [oldKeys])).rowCount;
        if (relocating)
        {
            const active = await client.query(`SELECT 1 FROM gameai.executions WHERE state IN ('assigned','running','unknown')
                UNION ALL SELECT 1 FROM gameai.agent_runs WHERE state IN ('running','unknown') LIMIT 1`);
            if (active.rowCount) throw new AgentInputError('存在执行中或待核实的任务，请结束后迁移技能绑定。');
        }
        await client.query('UPDATE gameai.skills SET enabled=false');
        for (const skill of await discoverSkills())
        {
            await client.query(`INSERT INTO gameai.skills(skill_key,name,path,role_code,content_hash)
                VALUES($1,$2,$3,$4,$5) ON CONFLICT(skill_key) DO UPDATE SET name=EXCLUDED.name,path=EXCLUDED.path,
                role_code=EXCLUDED.role_code,content_hash=EXCLUDED.content_hash,enabled=true`,
            [skill.skill_key, skill.name, skill.path, skill.role_code, skill.content_hash]);
        }
        for (const [previous, current] of Object.entries(skillRelocations))
        {
            await client.query(`INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,content_hash,is_primary)
                SELECT g.project_id,g.agent_id,s.skill_key,s.content_hash,g.is_primary FROM gameai.agent_skills g
                JOIN gameai.skills s ON s.skill_key=$2 WHERE g.skill_key=$1
                ON CONFLICT(agent_id,skill_key) DO NOTHING`, [previous,current]);
            await client.query('DELETE FROM gameai.agent_skills WHERE skill_key=$1', [previous]);
            await client.query('DELETE FROM gameai.skills WHERE skill_key=$1', [previous]);
        }
        if (relocating)
        {
            await client.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload)
                SELECT id,'local:skill-catalog','公共技能目录及绑定迁移',$1::jsonb FROM gameai.projects`,
                [JSON.stringify({relocations:skillRelocations})]);
        }
        await client.query('COMMIT');
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

export async function agentOptions(pool, projectKey)
{
    const workers = (await pool.query(`SELECT w.id,w.name,w.capacity,w.enabled,w.last_heartbeat_at
        FROM gameai.workers w JOIN gameai.projects p ON p.id=w.project_id WHERE p.project_key=$1 ORDER BY w.name`, [projectKey])).rows;
    const skills = (await pool.query('SELECT skill_key,name,path,role_code,content_hash FROM gameai.skills WHERE enabled ORDER BY skill_key')).rows;
    return { workers, skills };
}

export async function createAgent(pool, projectKey, raw)
{
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) throw new AgentInputError('请检查名称、角色、节点、技能和并发容量。');
    const input = parsed.data;
    const skillKeys = [input.primary_skill, ...input.extra_skills].sort();
    if (new Set(skillKeys).size !== skillKeys.length) throw new AgentInputError('技能不能重复选择。');
    const payloadHash = createHash('sha256').update(JSON.stringify({ ...input, extra_skills: [...input.extra_skills].sort() })).digest('hex');
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        const project = (await client.query('SELECT id FROM gameai.projects WHERE project_key=$1', [projectKey])).rows[0];
        if (!project) throw new AgentInputError('项目不存在。');
        // Serialize duplicate submissions; retries return the previously committed instance.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 71))', [project.id]);
        const previous = (await client.query('SELECT agent_key,creation_payload_hash FROM gameai.agents WHERE project_id=$1 AND creation_request_id=$2', [project.id, input.request_id])).rows[0];
        if (previous)
        {
            if (previous.creation_payload_hash !== payloadHash) throw new AgentInputError('请求编号已用于其他配置，请重新打开表单。');
            await client.query('COMMIT');
            return { id: previous.agent_key, repeated: true };
        }
        const worker = (await client.query('SELECT capacity FROM gameai.workers WHERE project_id=$1 AND id=$2', [project.id, input.worker_id])).rows[0];
        if (!worker || input.capacity > worker.capacity) throw new AgentInputError('节点无效，或并发容量超过节点上限。');
        const skills = (await client.query('SELECT * FROM gameai.skills WHERE enabled AND skill_key=ANY($1::text[])', [skillKeys])).rows;
        if (skills.length !== skillKeys.length || !skills.some(s => s.skill_key === input.primary_skill && isPrimarySkill(s) && s.role_code === input.role) || skills.some(s => s.skill_key !== input.primary_skill && !canUseExtraSkill(s, input.role)))
        {
            throw new AgentInputError('主技能必须匹配角色，专业技能必须属于本角色，不能使用其他角色的主技能。');
        }
        for (const skill of skills)
        {
            const bytes = await readSkill(skill.skill_key);
            if (createHash('sha256').update(bytes).digest('hex') !== skill.content_hash) throw new AgentInputError('技能文件已更新，请同步技能目录后重新添加。');
        }
        const key = input.role.toLowerCase() + '-' + randomUUID().slice(0, 8);
        const agent = (await client.query(`INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity,creation_request_id,creation_payload_hash)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [project.id, key, input.role, input.worker_id, input.enabled, input.name, input.capacity, input.request_id, payloadHash])).rows[0];
        for (const skill of skills)
        {
            await client.query('INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,content_hash,is_primary) VALUES($1,$2,$3,$4,$5)', [project.id, agent.id, skill.skill_key, skill.content_hash, skill.skill_key === input.primary_skill]);
        }
        await client.query("INSERT INTO gameai.agent_grants(project_id,agent_id,permission_code) VALUES($1,$2,'project.read')", [project.id, agent.id]);
        await client.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'local:agent-manager','手动添加 Agent 配置',$2)", [project.id, { id: key, name: input.name, role: input.role, skills: skillKeys, enabled: input.enabled }]);
        await client.query('COMMIT');
        return { id: key, repeated: false };
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new AgentInputError('该项目已存在同名 Agent，请更换名称。');
        throw error;
    }
    finally
    {
        client.release();
    }
}


export async function addAgentSkills(pool,projectKey,raw)
{
    const parsed=z.object({agent:z.string().min(1).max(100),skills:z.array(z.string().regex(skillKeyPattern)).min(1).max(16)}).strict().safeParse(raw);
    if(!parsed.success || new Set(parsed.data.skills).size!==parsed.data.skills.length) throw new AgentInputError('请选择不重复的辅助技能。');
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const project=(await c.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if(!project) throw new AgentInputError('项目不存在。');
        // Share the claim lock so skill changes cannot race task startup.
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[project.id]);
        const agent=(await c.query('SELECT id,agent_key,role_code FROM gameai.agents WHERE project_id=$1 AND agent_key=$2',[project.id,parsed.data.agent])).rows[0];
        if(!agent) throw new AgentInputError('Agent 不存在。');
        const busy=await c.query(`SELECT 1 FROM gameai.executions WHERE agent_id=$1 AND state IN ('assigned','running','unknown') UNION ALL
            SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id WHERE s.agent_id=$1 AND r.state IN ('running','unknown')`,[agent.id]);
        if(busy.rowCount) throw new AgentInputError('Agent 正在工作或待核实，请结束后添加技能。');
        const existing=(await c.query('SELECT skill_key,is_primary FROM gameai.agent_skills WHERE agent_id=$1',[agent.id])).rows;
        const missing=parsed.data.skills.filter(key=>!existing.some(s=>s.skill_key===key));
        if(existing.filter(s=>!s.is_primary).length+missing.length>16) throw new AgentInputError('辅助技能最多 16 项。');
        const skills=(await c.query('SELECT * FROM gameai.skills WHERE enabled AND skill_key=ANY($1::text[])',[parsed.data.skills])).rows;
        if(skills.length!==parsed.data.skills.length || skills.some(s=>!canUseExtraSkill(s,agent.role_code))) throw new AgentInputError('只能添加启用的辅助技能，不能替换角色主技能。');
        for(const skill of skills)
        {
            const bytes=await readSkill(skill.skill_key);
            if(createHash('sha256').update(bytes).digest('hex')!==skill.content_hash) throw new AgentInputError('技能已更新，请同步技能目录后重试。');
        }
        for(const skill of skills.filter(s=>missing.includes(s.skill_key)))
        {
            await c.query('INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,content_hash,is_primary) VALUES($1,$2,$3,$4,false)',[project.id,agent.id,skill.skill_key,skill.content_hash]);
        }
        if(missing.length) await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'local:agent-manager','人工添加 Agent 技能',$2)",[project.id,{agent:agent.agent_key,summary:missing.join('、')}]);
        await c.query('COMMIT');
        return {agent:agent.agent_key,added:missing};
    }
    catch(error){await c.query('ROLLBACK');throw error;}
    finally {c.release();}
}
