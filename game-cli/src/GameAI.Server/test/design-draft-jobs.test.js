import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createPool} from '../src/database/connection.js';
import {designDraftRequest} from '../src/database/design-draft-jobs.js';
import {resumeDesignDrafts} from '../src/track/design-draft-flow.js';
import {validateRoleOperationClaim} from '../src/database/role-operation-claims.js';
import {designExecutionIds} from '../src/database/recovery-protocol.js';
import {reviewedHtml} from './ui-production-fixture.js';
import {tempRoot} from '../src/paths.js';

async function fixture(action)
{
    const pool=createPool();
    const c=await pool.connect();
    await c.query('BEGIN');
    const service={query:(s,p)=>c.query(s,p),connect:async()=>({query:(s,p)=>c.query(s==='BEGIN'?'SAVEPOINT draft_test':s==='COMMIT'?'RELEASE SAVEPOINT draft_test':s==='ROLLBACK'?'ROLLBACK TO SAVEPOINT draft_test':s,p),release(){}})};
    const directories=[];
    try
    {
        const key='DRAFT-'+randomUUID();
        const project=(await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[key])).rows[0].id;
        const worker=(await c.query('INSERT INTO gameai.workers(project_id,worker_key,name,capacity,enabled) VALUES($1,$2,$2,1,true) RETURNING id',[project,hostname()])).rows[0].id;
        const agent=(await c.query("INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity) VALUES($1,'Design','Design',$2,true,'Design',1) RETURNING id",[project,worker])).rows[0].id;
        await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'Design',$2)",[project,agent]);
        const conversation=(await c.query("INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id,thread_id) VALUES($1,'TEST-DRAFT','Design',$2,$3,'draft-thread') RETURNING id",[project,agent,worker])).rows[0].id;
        const input={request_id:randomUUID(),requirement_key:'TEST-DRAFT',version:'v1',prompt:'Approved scope',draft_approval:'Conversation approved v1',recovery_authorized:true};
        const request=raw=>designDraftRequest(service,key,raw ?? input);
        const job=()=>c.query('SELECT * FROM gameai.design_draft_jobs WHERE project_id=$1',[project]).then(r=>r.rows[0]);
        const tick=execute=>resumeDesignDrafts(service,{projectId:project,execute});
        const proof=(id,state)=>c.query("INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state) VALUES($1,$2,$3,$4)",[id,conversation,'0'.repeat(64),state]);
        const due=()=>c.query("UPDATE gameai.design_draft_jobs SET next_attempt_at=now()-interval '1 second',started_at=now()-interval '21 minutes' WHERE project_id=$1",[project]);
        await action({c,service,project,agent,input,request,job,tick,proof,due,directories});
        const row=await job();
        if(row) directories.push(join(tempRoot,'design-jobs',row.id));
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
        for(const directory of directories)
        {
            assert.ok(resolve(directory).startsWith(resolve(tempRoot)+sep));
            await rm(directory,{recursive:true,force:true});
        }
    }
}

test('oversized review input retains its actual cause and stops identical retries',()=>fixture(async f=>
{
    await f.request();
    await f.tick(async()=>({code:3,output:'',diagnostics:'CODEX_INPUT_TOO_LARGE: actual_chars=1764877, max_chars=1048576.\n'}));
    assert.equal((await f.job()).state,'attention');
    assert.match((await f.job()).error,/CODEX_INPUT_TOO_LARGE/);
    await f.due();
    await f.tick(async()=>assert.fail('must not repeat oversized input'));
}));

test('verified host repair grants one additional attempt and retains the original request',()=>fixture(async f=>
{
    const original=await f.request();
    const execute=async()=>{throw new Error('injected transport failure');};
    for(let i=0;i<4;i++)
    {
        await f.due();
        await f.tick(execute);
    }
    await f.due();
    const options={projectId:f.project,execute,repairedJob:{id:original.job_id,reason:'Verified transport fix'}};
    await resumeDesignDrafts(f.service,options);
    assert.equal((await f.job()).attempts,4);
    assert.equal((await f.job()).request_id,f.input.request_id);
    await f.due();
    await resumeDesignDrafts(f.service,{...options,execute:async()=>assert.fail('repair grant must not repeat')});
    assert.equal((await f.job()).state,'attention');
    assert.equal((await f.job()).attempts,4);
}));

test('technical recovery reuses a complete draft before invoking review',()=>fixture(async f=>
{
    await f.request();
    await f.tick(async()=>{throw new Error('transport failure');});
    const prior=await f.job();
    const directory=join(tempRoot,'design',prior.execution_id);
    await mkdir(directory,{recursive:true});
    f.directories.push(directory);
    const path=join(directory,'0-draft.json');
    await writeFile(path,JSON.stringify({html:'<html><body>saved</body></html>',questions:[]}));
    await f.due();
    await f.tick(async args=>
    {
        assert.equal(args[args.indexOf('--draft-file')+1],path);
        return {code:3,output:JSON.stringify({questions:['review-only test']})};
    });
    assert.equal((await f.job()).state,'needs_input');
}));

test('initial Design input is immutable and retries stop after three attempts without creating tasks',()=>fixture(async f=>
{
    const first=await f.request();
    assert.equal((await f.request()).job_id,first.job_id);
    await assert.rejects(f.request({...f.input,prompt:'changed'}),/同一请求/);
    await assert.rejects(f.request({...f.input,request_id:randomUUID()}),/已有 Design 请求/);
    let calls=0;
    const execute=async()=>{calls++;throw new Error('injected host failure');};
    for(let i=0;i<4;i++)
    {
        await f.due();
        await f.tick(execute);
    }
    assert.equal(calls,3);
    assert.equal((await f.job()).state,'attention');
    assert.equal((await f.c.query('SELECT count(*)::int n FROM gameai.tasks WHERE project_id=$1',[f.project])).rows[0].n,0);
}));

test('unknown Design process prevents restart; cancellation rejects its late stage claims',()=>fixture(async f=>
{
    await f.request();
    await f.tick(async args=>
    {
        await f.proof(designExecutionIds(args[args.indexOf('--execution-id')+1])[0],'unknown');
        throw new Error('connection lost');
    });
    await f.due();
    await f.tick(async()=>{throw new Error('must not execute');});
    const job=await f.job();
    assert.equal(job.state,'unknown');
    assert.equal(job.attempts,1);
    assert.equal((await f.request({action:'cancel',request_id:f.input.request_id})).state,'cancelled');
    await assert.rejects(validateRoleOperationClaim(f.c,f.project,{role:'Design',execution_id:designExecutionIds(job.execution_id)[1]},f.agent),/初稿操作/);
}));

test('Design questions require input even when the CLI exits nonzero',()=>fixture(async f=>
{
    await f.request();
    await f.tick(async()=>({code:3,output:JSON.stringify({questions:['需要确认窗口范围']})}));
    assert.equal((await f.job()).state,'needs_input');
    await f.due();
    await f.tick(async()=>assert.fail('a decision is not a technical retry'));
    assert.equal((await f.job()).attempts,1);
}));

test('disabled original Agent waits without spending attempts and continues when restored',()=>fixture(async f=>
{
    await f.request();
    await f.c.query('UPDATE gameai.agents SET enabled=false WHERE id=$1',[f.agent]);
    await f.tick(async()=>assert.fail('disabled agent must not execute'));
    assert.equal((await f.job()).attempts,0);
    await f.c.query('UPDATE gameai.agents SET enabled=true WHERE id=$1',[f.agent]);
    await f.due();
    await f.tick(async()=>({code:3,output:JSON.stringify({questions:['需要补充依据']})}));
    assert.equal((await f.job()).attempts,1);
    assert.equal((await f.job()).state,'needs_input');
}));

test('restart replays the original saved Design result and submits exactly one unapproved version',()=>fixture(async f=>
{
    await f.request();
    let calls=0;
    await f.tick(async args=>
    {
        calls++;
        const operation=args[args.indexOf('--execution-id')+1];
        const execution=designExecutionIds(operation)[0];
        await f.proof(execution,'completed');
        const directory=join(tempRoot,'design',operation);
        f.directories.push(directory);
        await mkdir(directory,{recursive:true});
        const html=reviewedHtml(f.project,execution,'draft-thread');
        const submission=join(directory,'submission.json');
        await writeFile(submission,JSON.stringify({request_id:randomUUID(),requirement_key:'TEST-DRAFT',title:'Draft',version:'v1',html,sha256:createHash('sha256').update(html).digest('hex'),execution_id:execution,thread_id:'draft-thread',summary:'Verified draft'}));
        await writeFile(join(directory,'response.json'),JSON.stringify({status:'draft_saved',submission}));
        throw new Error('injected disconnect after result persistence');
    });
    await f.due();
    await f.tick(async()=>{calls++;throw new Error('must replay saved output');});
    const result=await f.job();
    assert.equal(result.state,'completed',result.error);
    assert.equal(calls,1);
    assert.equal(result.attempts,1);
    assert.equal(result.receipt.status,'待审批');
    await f.tick(async()=>{calls++;});
    assert.equal(calls,1);
    assert.equal((await f.c.query('SELECT count(*)::int n FROM gameai.requirement_versions WHERE project_id=$1',[f.project])).rows[0].n,1);
    assert.equal((await f.c.query('SELECT count(*)::int n FROM gameai.approvals WHERE project_id=$1',[f.project])).rows[0].n,0);
}));
