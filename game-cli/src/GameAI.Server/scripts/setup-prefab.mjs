import {createPool} from '../src/database/connection.js';
import {syncSkillCatalog} from '../src/database/agents.js';

const pool=createPool();
try
{
    await syncSkillCatalog(pool);
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const p=(await c.query('SELECT id FROM gameai.projects WHERE project_key=$1',[process.env.GAMEAI_PROJECT_KEY ?? 'DEMO'])).rows[0];
        if(!p) throw new Error('Project missing');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[p.id]);
        const worker=(await c.query("SELECT a.worker_id FROM gameai.fixed_agents f JOIN gameai.agents a ON a.id=f.agent_id WHERE f.project_id=$1 AND f.role_code='Development'",[p.id])).rows[0];
        if(!worker) throw new Error('Existing development worker is required');
        // Never reset existing Agent configuration or automatic-execution consent.
        await c.query(`INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,display_name,capacity,enabled,auto_execute)
            VALUES($1,'prefab-01','Prefab',$2,'预制 Agent 01',1,true,false) ON CONFLICT(project_id,agent_key) DO NOTHING`,[p.id,worker.worker_id]);
        const a=(await c.query("SELECT id,role_code FROM gameai.agents WHERE project_id=$1 AND agent_key='prefab-01'",[p.id])).rows[0];
        if(a.role_code!=='Prefab') throw new Error('Existing Agent role mismatch');
        await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'Prefab',$2) ON CONFLICT DO NOTHING",[p.id,a.id]);
        await c.query(`INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,content_hash,is_primary)
            SELECT $1,$2,skill_key,content_hash,true FROM gameai.skills WHERE skill_key='prefab/PrefabAgent01' AND enabled
            ON CONFLICT(agent_id,skill_key) DO UPDATE SET content_hash=EXCLUDED.content_hash`,[p.id,a.id]);
        await c.query("INSERT INTO gameai.agent_grants VALUES($1,$2,'project.read'),($1,$2,'task.write_assigned') ON CONFLICT DO NOTHING",[p.id,a.id]);
        await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'local:setup','配置独立 Prefab Agent',$2)",[p.id,{agent:'prefab-01',skill:'prefab/PrefabAgent01'}]);
        await c.query('COMMIT');
        console.log('Prefab Agent configured; existing automation grants preserved.');
    }
    catch(error) {await c.query('ROLLBACK');throw error;}
    finally {c.release();}
}
finally {await pool.end();}
