import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/database/connection.js';
import { clearProjectTasks } from '../src/database/task-clear.js';

test('business reset is authorized, scoped, idle-only and preserves configuration (rollback)', async () =>
{
    const pool = createPool();
    const c = await pool.connect();
    await c.query('BEGIN');
    const service = { connect:async () => ({release() {}, query:async (sql,params) => {
        if (sql === 'BEGIN') return c.query('SAVEPOINT clear_test');
        if (sql === 'COMMIT') return c.query('RELEASE SAVEPOINT clear_test');
        if (sql === 'ROLLBACK') return c.query('ROLLBACK TO SAVEPOINT clear_test');
        return c.query(sql,params);
    }}) };
    try
    {
        const key = 'CLEAR-'+randomUUID();
        const p = (await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[key])).rows[0].id;
        const user = (await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        await c.query("INSERT INTO gameai.user_roles VALUES($1,$2,'Design')",[p,user]);
        const req = (await c.query("INSERT INTO gameai.requirements(project_id,requirement_key,title) VALUES($1,'TEST','测试') RETURNING id",[p])).rows[0].id;
        const v = (await c.query("INSERT INTO gameai.requirement_versions(project_id,requirement_id,version,ordinal,content,content_hash) VALUES($1,$2,'v1',1,'{}',$3) RETURNING id",[p,req,'a'.repeat(64)])).rows[0].id;
        const plan = (await c.query('INSERT INTO gameai.plans(project_id,requirement_id) VALUES($1,$2) RETURNING id',[p,req])).rows[0].id;
        const pv = (await c.query("INSERT INTO gameai.plan_versions(project_id,plan_id,requirement_version_id,version,state) VALUES($1,$2,$3,1,'published') RETURNING id",[p,plan,v])).rows[0].id;
        const parent = (await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code) VALUES($1,$2,'主任务','PM') RETURNING id",[p,pv])).rows[0].id;
        await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,parent_id,title,role_code) VALUES($1,$2,$3,'子任务','Art')",[p,pv,parent]);
        const otherCount = (await c.query('SELECT count(*) FROM gameai.tasks WHERE project_id<>$1',[p])).rows[0].count;
        await assert.rejects(clearProjectTasks(service,key,randomUUID()),/审批权限/);
        await c.query("INSERT INTO gameai.approval_workflows(version_id,project_id,requested_by,revision,document_hash,state) VALUES($1,$2,$3,'r',$4,'queued')",[v,p,user,'a'.repeat(64)]);
        await assert.rejects(clearProjectTasks(service,key,user),/执行中/);
        assert.equal((await c.query('SELECT count(*) FROM gameai.tasks WHERE project_id=$1',[p])).rows[0].count,'2');
        await c.query("UPDATE gameai.approval_workflows SET state='dispatched' WHERE project_id=$1",[p]);
        const worker = (await c.query("INSERT INTO gameai.workers(project_id,worker_key,name,capacity) VALUES($1,'reset-test','reset-test',1) RETURNING id",[p])).rows[0].id;
        const agent = (await c.query("INSERT INTO gameai.agents(project_id,agent_key,display_name,role_code,worker_id) VALUES($1,'reset-design','Reset Design','Design',$2) RETURNING id",[p,worker])).rows[0].id;
        await c.query("INSERT INTO gameai.design_draft_jobs(project_id,request_id,input_hash,input,design_agent_id) VALUES($1,$2,'hash','{}',$3)",[p,randomUUID(),agent]);
        for (const state of ['queued','running','unknown'])
        {
            await c.query('UPDATE gameai.design_draft_jobs SET state=$2 WHERE project_id=$1',[p,state]);
            await assert.rejects(clearProjectTasks(service,key,user),/执行中/);
        }
        await c.query("UPDATE gameai.design_draft_jobs SET state='completed' WHERE project_id=$1",[p]);
        assert.deepEqual(await clearProjectTasks(service,key,user),{cleared:2,requirements:1});
        assert.equal((await c.query('SELECT count(*) FROM gameai.design_draft_jobs WHERE project_id=$1',[p])).rows[0].count,'0');
        assert.equal((await c.query('SELECT count(*) FROM gameai.tasks WHERE project_id<>$1',[p])).rows[0].count,otherCount);
        for (const table of ['projects','user_roles'])
        {
            const field = table === 'projects' ? 'id' : 'project_id';
            assert.equal((await c.query(`SELECT count(*) FROM gameai.${table} WHERE ${field}=$1`,[p])).rows[0].count,'1');
        }
        assert.equal((await c.query('SELECT count(*) FROM gameai.approval_workflows WHERE project_id=$1',[p])).rows[0].count,'0');
        for (const table of ['requirements','requirement_versions'])
        {
            assert.equal((await c.query(`SELECT count(*) FROM gameai.${table} WHERE project_id=$1`,[p])).rows[0].count,'0');
        }
        const guards = await c.query("SELECT tgenabled FROM pg_trigger WHERE tgname IN ('immutable_approval','immutable_requirement_version','immutable_document')");
        assert.equal(guards.rows.length,3);
        assert.ok(guards.rows.every(row=>row.tgenabled==='O'));
        assert.deepEqual(await clearProjectTasks(service,key,user),{cleared:0,requirements:0});
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
