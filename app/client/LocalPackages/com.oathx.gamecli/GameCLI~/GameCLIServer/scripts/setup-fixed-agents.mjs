import { createPool } from '../src/database/connection.js';
import { syncSkillCatalog } from '../src/database/agents.js';
import { hostname } from 'node:os';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import pg from 'pg';

const pool = createPool();
const projectKey = process.env.GAMEAI_PROJECT_KEY ?? 'DEMO';
const workerKey = hostname().toLowerCase();
const definitions = [['Design','design-01','策划 Agent 01','gameai-design'],['PM','pm-01','PM Agent 01','gameai-pm'],['Art','art-01','美术 Agent 01','gameai-art'],['Development','dev-01','开发 Agent 01','gameai-dev'],['QA','qa-01','QA Agent 01','gameai-qa']];
try
{
    await syncSkillCatalog(pool);
    const c = await pool.connect();
    try
    {
        await c.query('BEGIN');
        const p = (await c.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if (!p)
        {
            throw new Error('Project missing');
        }
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[p.id]);
        if ((await c.query("SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id WHERE s.project_id=$1 AND r.state IN ('running','unknown')",[p.id])).rowCount)
        {
            throw new Error('Active runs must finish before setup');
        }
        const w = (await c.query(`INSERT INTO gameai.workers(project_id,worker_key,name,capacity,enabled) VALUES($1,$2,$3,5,true)
            ON CONFLICT(project_id,worker_key) DO UPDATE SET enabled=true RETURNING id`,[p.id,workerKey,'本机 GameCLI · '+hostname()])).rows[0];
        for (const [role,key,name,skill] of definitions)
        {
            const a = (await c.query(`INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity)
                VALUES($1,$2,$3,$4,true,$5,1) ON CONFLICT(project_id,agent_key) DO UPDATE SET enabled=true,worker_id=EXCLUDED.worker_id,capacity=1,display_name=EXCLUDED.display_name RETURNING id`,[p.id,key,role,w.id,name])).rows[0];
            await c.query('INSERT INTO gameai.fixed_agents VALUES($1,$2,$3) ON CONFLICT(project_id,role_code) DO UPDATE SET agent_id=EXCLUDED.agent_id',[p.id,role,a.id]);
            await c.query('DELETE FROM gameai.agent_skills WHERE agent_id=$1',[a.id]);
            await c.query(`INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,content_hash,is_primary)
                SELECT $1,$2,skill_key,content_hash,skill_key=$3 FROM gameai.skills WHERE skill_key=ANY($4::text[]) AND enabled`,[p.id,a.id,skill,[skill,'gameai-common','gameai-cli-development']]);
            await c.query("INSERT INTO gameai.agent_grants VALUES($1,$2,'project.read') ON CONFLICT DO NOTHING",[p.id,a.id]);
        }
        // Adopt the recorded Design conversation on this same host; do not change approved content.
        await c.query(`INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id,thread_id)
            SELECT DISTINCT ON(r.id) r.project_id,r.requirement_key,'Design',f.agent_id,$2,v.content->>'thread_id'
            FROM gameai.requirements r JOIN gameai.requirement_versions v ON v.requirement_id=r.id
            JOIN gameai.fixed_agents f ON f.project_id=r.project_id AND f.role_code='Design'
            WHERE r.project_id=$1 AND v.content->>'thread_id' IS NOT NULL ORDER BY r.id,v.ordinal DESC
            ON CONFLICT(project_id,requirement_key,role_code) DO NOTHING`,[p.id,w.id]);
        const config = parseEnv(await readFile(new URL('../.env.workflow',import.meta.url),'utf8'));
        const writer = pg.escapeIdentifier(config.PGUSER);
        await c.query('GRANT SELECT ON gameai.fixed_agents,gameai.agent_conversations,gameai.agent_runs TO '+writer);
        await c.query('GRANT INSERT,UPDATE ON gameai.agent_conversations,gameai.agent_runs TO '+writer);
        await c.query('GRANT UPDATE(last_heartbeat_at) ON gameai.workers TO '+writer);
        await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'local:setup','启用五个固定角色 Agent',$2)",[p.id,{worker:workerKey,agents:definitions.map(d=>d[1])}]);
        await c.query('COMMIT');
        const directory = new URL('../../../../../../../.gamecli/',import.meta.url);
        await mkdir(directory,{recursive:true});
        await writeFile(new URL('client.json',directory),JSON.stringify({server:process.env.GAMEAI_SERVER_URL ?? 'http://127.0.0.1:18090',worker_key:workerKey,token:config.SUBMISSION_TOKEN},null,2));
        console.log('五个固定 Agent 已启用，本机连接配置已写入被忽略的 .gamecli/client.json。');
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
finally
{
    await pool.end();
}
