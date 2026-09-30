import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../src/database/connection.js';
import {createAgent,addAgentSkills} from '../src/database/agents.js';

test('skill additions preserve primary skills, are idempotent and reject role changes or busy agents (rollback)',async()=>
{
    const pool=createPool();const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const scoped={connect:async()=>({release(){},query:async(sql,args)=>
        {
            if(sql==='BEGIN') return c.query('SAVEPOINT skill_test');
            if(sql==='COMMIT') return c.query('RELEASE SAVEPOINT skill_test');
            if(sql==='ROLLBACK') return c.query('ROLLBACK TO SAVEPOINT skill_test');
            return c.query(sql,args);
        }})};
        const worker=(await c.query("SELECT w.* FROM gameai.workers w JOIN gameai.projects p ON p.id=w.project_id WHERE p.project_key='DEMO' AND w.enabled LIMIT 1")).rows[0];
        const created=await createAgent(scoped,'DEMO',{request_id:randomUUID(),name:'技能回滚测试 '+randomUUID(),role:'Art',worker_id:worker.id,primary_skill:'gameai-art',extra_skills:[],capacity:1,enabled:true});
        assert.deepEqual((await addAgentSkills(scoped,'DEMO',{agent:created.id,skills:['gameai-common']})).added,['gameai-common']);
        assert.deepEqual((await addAgentSkills(scoped,'DEMO',{agent:created.id,skills:['gameai-common']})).added,[]);
        await assert.rejects(addAgentSkills(scoped,'DEMO',{agent:created.id,skills:['gameai-dev']}),/辅助技能/);
        assert.deepEqual((await addAgentSkills(scoped,'DEMO',{agent:created.id,skills:['gameai-art/art-ui']})).added,['gameai-art/art-ui']);
        await assert.rejects(addAgentSkills(scoped,'DEMO',{agent:created.id,skills:['gameai-qa/qa-web']}),/辅助技能/);
        await assert.rejects(createAgent(scoped,'DEMO',{request_id:randomUUID(),name:'错误主技能 '+randomUUID(),role:'Art',worker_id:worker.id,primary_skill:'gameai-art/art-ui',extra_skills:[],capacity:1,enabled:true}),/主技能必须匹配/);
        const agent=(await c.query('SELECT * FROM gameai.agents WHERE agent_key=$1',[created.id])).rows[0];
        assert.equal((await c.query('SELECT skill_key FROM gameai.agent_skills WHERE agent_id=$1 AND is_primary',[agent.id])).rows[0].skill_key,'gameai-art');
        const conversation=(await c.query("INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id) VALUES($1,$2,'Art',$3,$4) RETURNING id",[worker.project_id,'test-'+randomUUID(),agent.id,worker.id])).rows[0];
        await c.query("INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state,expires_at) VALUES($1,$2,$3,'running',now()+interval '1 minute')",[randomUUID().replaceAll('-',''),conversation.id,'a'.repeat(64)]);
        await assert.rejects(addAgentSkills(scoped,'DEMO',{agent:created.id,skills:['gameai-common/gameai-document-format']}),/正在工作/);
    }
    finally {await c.query('ROLLBACK');c.release();await pool.end();}
});
