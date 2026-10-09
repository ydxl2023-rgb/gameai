import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createPool } from '../src/database/connection.js';
import { agentRunRequest } from '../src/database/agent-runs.js';
import { submitRequirement } from '../src/database/requirements.js';

// Isolated fixtures are rolled back, preserving all user requirements and approvals.
test('fixed identity, capacity, lease and conversation recovery', async () =>
{
    const pool = createPool();
    const c = await pool.connect();
    await c.query('BEGIN');
    const service = { connect: async () => ({
        query: async (sql, params) =>
        {
            if (sql === 'BEGIN') { return c.query('SAVEPOINT operation'); }
            if (sql === 'COMMIT') { return c.query('RELEASE SAVEPOINT operation'); }
            if (sql === 'ROLLBACK')
            {
                await c.query('ROLLBACK TO SAVEPOINT operation');
                return c.query('RELEASE SAVEPOINT operation');
            }
            return c.query(sql, params);
        }, release: () => {}
    }) };
    const call = input => agentRunRequest(service, key, input);
    const key = 'AGENT-TEST-' + randomUUID();
    try
    {
        const p = (await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[key])).rows[0].id;
        const w = (await c.query("INSERT INTO gameai.workers(project_id,worker_key,name,capacity,enabled) VALUES($1,'test-worker','Test',1,true) RETURNING id",[p])).rows[0].id;
        const a = (await c.query("INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity) VALUES($1,'design-test','Design',$2,true,'Test',1) RETURNING id",[p,w])).rows[0].id;
        await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'Design',$2)",[p,a]);
        await c.query("INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,content_hash,is_primary) SELECT $1,$2,skill_key,content_hash,true FROM gameai.skills WHERE skill_key='gameai-design'",[p,a]);
        const input = {action:'claim',execution_id:randomUUID().replaceAll('-',''),role:'Design',requirement_key:'TEST-REQ',worker_key:'test-worker',input_hash:'a'.repeat(64)};
        const update = {execution_id:input.execution_id,worker_key:input.worker_key};
        await assert.rejects(call({...input,worker_key:'wrong'}), /节点/);
        await assert.rejects(call({...input,role:'Art'}), /固定 Agent/);
        const first = await call(input);
        assert.equal(first.agent_key,'design-test');
        assert.equal(first.thread_id,null);
        assert.ok(first.instructions.includes('Design'));
        assert.deepEqual(await call(input),first);
        await assert.rejects(call({...input,input_hash:'b'.repeat(64)}), /已使用/);
        await assert.rejects(call({...input,execution_id:randomUUID().replaceAll('-',''),requirement_key:'OTHER'}), /忙碌/);
        await assert.rejects(call({...update,action:'finish',state:'completed'}), /会话缺失/);
        await call({...update,action:'attach',thread_id:'thread-original'});
        await assert.rejects(call({...update,action:'attach',thread_id:'thread-other'}), /替换/);
        await call({...update,action:'heartbeat'});
        const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>固定角色测试</title></head><body>测试策划</body></html>';
        const document = {request_id:randomUUID(),requirement_key:input.requirement_key,title:'测试',version:'v1',html,
            sha256:createHash('sha256').update(html).digest('hex'),execution_id:input.execution_id,thread_id:'thread-original',summary:'测试'};
        await assert.rejects(submitRequirement(service,key,document), /已完成执行/);
        await call({...update,action:'finish',state:'completed'});
        await call({...update,action:'finish',state:'completed'});
        await assert.rejects(submitRequirement(service,key,{...document,thread_id:'wrong-thread'}), /已完成执行/);
        assert.equal((await submitRequirement(service,key,document)).status,'待审批');
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.approvals WHERE project_id=$1',[p])).rows[0].n,0);
        const resumedInput = {...input,execution_id:randomUUID().replaceAll('-','')};
        const resumed = await call(resumedInput);
        assert.equal(resumed.thread_id,'thread-original');
        assert.equal(resumed.conversation_id,first.conversation_id);
        await call({...update,execution_id:resumedInput.execution_id,action:'finish',state:'failed'});
        const otherInput = {...input,execution_id:randomUUID().replaceAll('-',''),requirement_key:'OTHER'};
        assert.equal((await call(otherInput)).thread_id,null);
        await c.query("UPDATE gameai.agent_runs SET expires_at=now()-interval '1 second' WHERE execution_id=$1",[otherInput.execution_id]);
        await assert.rejects(call({...update,execution_id:otherInput.execution_id,action:'finish',state:'completed'}), /已失效/);
        await assert.rejects(call({...input,execution_id:randomUUID().replaceAll('-','')}), /忙碌/);
        await c.query('UPDATE gameai.agents SET enabled=false WHERE id=$1',[a]);
        await assert.rejects(call({...input,execution_id:randomUUID().replaceAll('-','')}), /固定 Agent/);
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
