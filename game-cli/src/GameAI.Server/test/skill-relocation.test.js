import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../src/database/connection.js';
import {createAgent,syncSkillCatalog} from '../src/database/agents.js';

test('catalog relocation preserves Agent bindings and grants; repeated synchronization is idempotent (rollback)',async () =>
{
    const pool=createPool();
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const scoped={connect:async()=>({release(){},query:async(sql,args)=>
        {
            if(sql==='BEGIN') return c.query('SAVEPOINT relocation_test');
            if(sql==='COMMIT') return c.query('RELEASE SAVEPOINT relocation_test');
            if(sql==='ROLLBACK') return c.query('ROLLBACK TO SAVEPOINT relocation_test');
            return c.query(sql,args);
        }})};
        const worker=(await c.query("SELECT w.* FROM gameai.workers w JOIN gameai.projects p ON p.id=w.project_id WHERE p.project_key='DEMO' AND w.enabled LIMIT 1")).rows[0];
        const created=await createAgent(scoped,'DEMO',{request_id:randomUUID(),name:'目录迁移回滚 '+randomUUID(),role:'Art',worker_id:worker.id,primary_skill:'art/MasayoshiSuto',extra_skills:[],capacity:1,enabled:true});
        const agent=(await c.query('SELECT * FROM gameai.agents WHERE agent_key=$1',[created.id])).rows[0];
        await c.query(`INSERT INTO gameai.skills(skill_key,name,path,role_code,content_hash)
            SELECT 'gameai-art',name,'skills/gameai-art/SKILL.md',role_code,content_hash
            FROM gameai.skills WHERE skill_key='art/MasayoshiSuto'`);
        await c.query("UPDATE gameai.agent_skills SET skill_key='gameai-art' WHERE agent_id=$1 AND is_primary",[agent.id]);
        const before=(await c.query('SELECT permission_code FROM gameai.agent_grants WHERE agent_id=$1',[agent.id])).rows;
        await syncSkillCatalog(scoped);
        await syncSkillCatalog(scoped);
        assert.equal((await c.query("SELECT count(*)::int n FROM gameai.agent_skills WHERE agent_id=$1 AND skill_key='art/MasayoshiSuto' AND is_primary",[agent.id])).rows[0].n,1);
        assert.equal((await c.query("SELECT count(*)::int n FROM gameai.skills WHERE skill_key='gameai-art'")).rows[0].n,0);
        assert.deepEqual((await c.query('SELECT permission_code FROM gameai.agent_grants WHERE agent_id=$1',[agent.id])).rows,before);
        assert.equal((await c.query('SELECT agent_key FROM gameai.agents WHERE id=$1',[agent.id])).rows[0].agent_key,created.id);
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
