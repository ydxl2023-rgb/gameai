import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { createPool } from '../src/database/connection.js';
import { submitRequirement,reviewRequirement } from '../src/database/requirements.js';
import { readLinkedHtml } from '../src/database/documents.js';

// All synthetic approvals are rolled back; no real pending document is approved by tests.
test('document submission, byte integrity, identity, versions and approval replay',async () =>
{
    const pool=createPool();
    const c=await pool.connect();
    await c.query('BEGIN');
    const servicePool={connect:async () => ({
        query:async (sql,params) =>
        {
            if (sql === 'BEGIN') return c.query('SAVEPOINT service_operation');
            if (sql === 'COMMIT') return c.query('RELEASE SAVEPOINT service_operation');
            if (sql === 'ROLLBACK')
            {
                await c.query('ROLLBACK TO SAVEPOINT service_operation');
                return c.query('RELEASE SAVEPOINT service_operation');
            }
            return c.query(sql,params);
        },release:() => {}
    })};
    try
    {
        const projectKey='REVIEW-TEST-'+randomUUID();
        const project=(await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[projectKey])).rows[0].id;
        const user=(await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        const outsider=(await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        await c.query("INSERT INTO gameai.user_roles VALUES($1,$2,'Design')",[project,user]);
        const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>测试</title></head><body><h1>测试需求</h1></body></html>';
        const input={request_id:randomUUID(),requirement_key:'TEST-REQ',title:'测试需求',version:'v1',html,sha256:createHash('sha256').update(html).digest('hex'),execution_id:'test-execution',thread_id:'test-thread',summary:'事务内测试'};
        const v1=await submitRequirement(servicePool,projectKey,input);
        assert.equal(v1.status,'待审批');
        assert.deepEqual(await submitRequirement(servicePool,projectKey,input),v1);
        await assert.rejects(submitRequirement(servicePool,projectKey,{...input,summary:'different'}),/重复请求/);
        await assert.rejects(submitRequirement(servicePool,projectKey,{...input,sha256:'0'.repeat(64)}),/哈希/);
        assert.equal((await readLinkedHtml(c,projectKey,v1.artifact_id)).toString('utf8'),html);
        assert.equal(await readLinkedHtml(c,'DEMO',v1.artifact_id),null);
        const decision={version_id:v1.version_id,revision:v1.revision,document_hash:input.sha256,decision:'approved',reason:''};
        await assert.rejects(reviewRequirement(servicePool,projectKey,outsider,decision),/权限/);
        await assert.rejects(reviewRequirement(servicePool,projectKey,user,{...decision,document_hash:'0'.repeat(64)}),/文档/);
        assert.equal((await reviewRequirement(servicePool,projectKey,user,decision)).decision,'approved');
        assert.equal((await reviewRequirement(servicePool,projectKey,user,decision)).repeated,true);
        await assert.rejects(reviewRequirement(servicePool,projectKey,user,{...decision,decision:'rejected',reason:'变更决定'}),/已经审批/);
        const v2=await submitRequirement(servicePool,projectKey,{...input,request_id:randomUUID(),version:'v2'});
        await assert.rejects(reviewRequirement(servicePool,projectKey,user,decision),/已更新/);
        const reject={version_id:v2.version_id,revision:v2.revision,document_hash:input.sha256,decision:'rejected',reason:''};
        await assert.rejects(reviewRequirement(servicePool,projectKey,user,reject),/原因/);
        assert.equal((await reviewRequirement(servicePool,projectKey,user,{...reject,reason:'需要修订'})).decision,'rejected');
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.approvals WHERE project_id=$1',[project])).rows[0].n,2);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.tasks WHERE project_id=$1',[project])).rows[0].n,0);
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
