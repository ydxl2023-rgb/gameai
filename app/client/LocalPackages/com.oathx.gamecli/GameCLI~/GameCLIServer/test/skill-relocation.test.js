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
        const created=await createAgent(scoped,'DEMO',{request_id:randomUUID(),name:'目录迁移回滚 '+randomUUID(),role:'Art',worker_id:worker.id,primary_skill:'gameai-art',extra_skills:[],capacity:1,enabled:true});
        const agent=(await c.query('SELECT * FROM gameai.agents WHERE agent_key=$1',[created.id])).rows[0];
        await c.query(`INSERT INTO gameai.skills(skill_key,name,path,role_code,content_hash)
            SELECT 'gameai-task-writing',name,'game-cli/gameai-task-writing/SKILL.md',role_code,content_hash
            FROM gameai.skills WHERE skill_key='gameai-common/gameai-task-writing'`);
        await c.query(`INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,content_hash,is_primary)
            SELECT $1,$2,skill_key,content_hash,false FROM gameai.skills WHERE skill_key='gameai-task-writing'`,[worker.project_id,agent.id]);
        const qaCreated=await createAgent(scoped,'DEMO',{request_id:randomUUID(),name:'Unity 合并回滚 '+randomUUID(),role:'QA',worker_id:worker.id,primary_skill:'gameai-qa',extra_skills:['gameai-dev/dev-unity'],capacity:1,enabled:true});
        const qaAgent=(await c.query('SELECT id FROM gameai.agents WHERE agent_key=$1',[qaCreated.id])).rows[0];
        await c.query(`INSERT INTO gameai.skills(skill_key,name,path,role_code,content_hash)
            SELECT 'gameai-dev/gameai-unity','gameai-unity','game-cli/gameai-dev/gameai-unity/SKILL.md',NULL,content_hash
            FROM gameai.skills WHERE skill_key='gameai-dev/dev-unity'`);
        await c.query(`INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,content_hash,is_primary)
            SELECT $1,$2,skill_key,content_hash,false FROM gameai.skills WHERE skill_key='gameai-dev/gameai-unity'`,[worker.project_id,qaAgent.id]);
        const before=(await c.query('SELECT permission_code FROM gameai.agent_grants WHERE agent_id=$1',[agent.id])).rows;
        await syncSkillCatalog(scoped);
        await syncSkillCatalog(scoped);
        assert.equal((await c.query("SELECT count(*)::int n FROM gameai.agent_skills WHERE agent_id=$1 AND skill_key='gameai-common/gameai-task-writing'",[agent.id])).rows[0].n,1);
        assert.equal((await c.query("SELECT count(*)::int n FROM gameai.skills WHERE skill_key='gameai-task-writing'")).rows[0].n,0);
        assert.equal((await c.query("SELECT count(*)::int n FROM gameai.agent_skills WHERE agent_id=$1 AND skill_key='gameai-dev/dev-unity'",[qaAgent.id])).rows[0].n,1);
        assert.equal((await c.query("SELECT count(*)::int n FROM gameai.skills WHERE skill_key='gameai-dev/gameai-unity'")).rows[0].n,0);
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
