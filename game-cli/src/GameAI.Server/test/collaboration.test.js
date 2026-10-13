import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../src/database/connection.js';
import {readCollaboration} from '../src/database/collaboration.js';
import {clearProjectTasks} from '../src/database/task-clear.js';

test('collaboration snapshots are transactional, paginated, scoped and survive business reset',async()=>
{
    const pool=createPool();const c=await pool.connect();await c.query('BEGIN');
    const service={query:(s,p)=>c.query(s,p),connect:async()=>({release(){},query:(s,p)=>c.query(s==='BEGIN'?'SAVEPOINT message_test':s==='COMMIT'?'RELEASE SAVEPOINT message_test':s==='ROLLBACK'?'ROLLBACK TO SAVEPOINT message_test':s,p)})};
    try
    {
        const key='CHAT-'+randomUUID();
        const project=(await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[key])).rows[0].id;
        const user=(await c.query("INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,'测试审批人',true) RETURNING id",[randomUUID()])).rows[0].id;
        await c.query("INSERT INTO gameai.user_roles VALUES($1,$2,'Design')",[project,user]);
        const requirement=(await c.query("INSERT INTO gameai.requirements(project_id,requirement_key,title) VALUES($1,'LOGIN','登录测试') RETURNING id",[project])).rows[0].id;
        const version=(await c.query("INSERT INTO gameai.requirement_versions(project_id,requirement_id,version,ordinal,content,content_hash) VALUES($1,$2,'v1',1,'{}',$3) RETURNING id",[project,requirement,'a'.repeat(64)])).rows[0].id;
        await c.query('SAVEPOINT rolled_back_event');
        await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','任务开始','{}')",[project]);
        assert.equal((await readCollaboration(service,key)).messages.length,1);
        await c.query('ROLLBACK TO SAVEPOINT rolled_back_event');
        assert.equal((await readCollaboration(service,key)).messages.length,0);
        for(let i=0;i<55;i++)
        {
            await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'需求已批准',$3)",[project,'human:'+user,{version_id:version,summary:'反馈 '+i,private_prompt:'不应复制原始提示词'}]);
        }
        const recent=await readCollaboration(service,key);
        assert.equal(recent.messages.length,50);assert.ok(recent.before);
        assert.equal(recent.messages[0].body,'反馈 5');assert.equal(recent.messages.at(-1).actor_name,'测试审批人');
        const older=await readCollaboration(service,key,{before:recent.before});
        assert.equal(older.messages.length,5);assert.equal(older.before,null);
        assert.equal((await readCollaboration(service,key,{role:'Art'})).messages.length,0);
        assert.equal((await readCollaboration(service,key,{search:'LOGIN'})).messages.length,50);
        assert.equal((await readCollaboration(service,'OTHER-'+key)).messages.length,0);
        assert.ok(!JSON.stringify(recent).includes('不应复制'));
        await assert.rejects(readCollaboration(service,key,{before:'invalid'}));
        await c.query('SAVEPOINT immutable_message');
        await assert.rejects(c.query('DELETE FROM gameai.collaboration_messages WHERE project_id=$1',[project]),/append-only/);
        await c.query('ROLLBACK TO SAVEPOINT immutable_message');
        await clearProjectTasks(service,key,user);
        const after=await readCollaboration(service,key);
        assert.equal(after.messages.length,50);
        assert.equal(after.messages.at(-1).requirement_title,'登录测试');
        assert.equal(after.messages.at(-1).version,'v1');
        assert.equal((await c.query('SELECT count(*) FROM gameai.requirements WHERE project_id=$1',[project])).rows[0].count,'0');
    }
    finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
