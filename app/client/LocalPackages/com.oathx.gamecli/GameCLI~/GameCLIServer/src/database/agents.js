import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { z } from 'zod';

const primaryRoles = { 'gameai-design': 'Design', 'gameai-pm': 'PM', 'gameai-art': 'Art', 'gameai-dev': 'Development', 'gameai-qa': 'QA' };
const skillDirectory = new URL('../../../../game-cli/', import.meta.url);
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
        await client.query('UPDATE gameai.skills SET enabled=false');
        for (const directory of await readdir(skillDirectory, { withFileTypes: true }))
        {
            if (!directory.isDirectory() || !directory.name.startsWith('gameai-')) continue;
            let bytes;
            try
            {
                bytes = await readFile(new URL(directory.name + '/SKILL.md', skillDirectory));
            }
            catch (error)
            {
                if (error.code === 'ENOENT')
                {
                    continue;
                }
                throw error;
            }
            const hash = createHash('sha256').update(bytes).digest('hex');
            await client.query(`INSERT INTO gameai.skills(skill_key,name,path,role_code,content_hash)
                VALUES($1,$1,$2,$3,$4) ON CONFLICT(skill_key) DO UPDATE SET path=EXCLUDED.path,
                role_code=EXCLUDED.role_code,content_hash=EXCLUDED.content_hash,enabled=true`,
            [directory.name, 'game-cli/' + directory.name + '/SKILL.md', primaryRoles[directory.name] ?? null, hash]);
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
        if (skills.length !== skillKeys.length || skills.find(s => s.skill_key === input.primary_skill)?.role_code !== input.role || skills.some(s => s.skill_key !== input.primary_skill && s.role_code !== null))
        {
            throw new AgentInputError('主技能必须匹配角色，辅助技能不能使用其他角色的主技能。');
        }
        for (const skill of skills)
        {
            const bytes = await readFile(new URL(skill.skill_key + '/SKILL.md', skillDirectory));
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
