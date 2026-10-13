import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createPool} from '../src/database/connection.js';
import {submitRequirement,reviewRequirement} from '../src/database/requirements.js';
import {startPmJob} from '../src/database/pm-plans.js';
import {parsePmOutcome,issueFingerprint,recordPmBlock} from '../src/database/requirement-revisions.js';
import {runRequirementRevision} from '../src/track/requirement-revision-flow.js';
import {tempRoot} from '../src/paths.js';
import {manifestFixture,htmlFixture} from './ui-delivery-fixture.js';

const report={outcome:'revision_required',summary:'控件数量与正文不一致',issues:[{section:'附录 C',evidence:'正文数量为2，清单为1',impact:'无法准确制作',suggestion:'正文改为1'}],tasks:[]};
test('PM outcomes distinguish document issues from runtime failures and reject ambiguous empty plans',()=>
{
    assert.equal(parsePmOutcome(report).outcome,'revision_required');
    assert.throws(()=>parsePmOutcome({summary:'停止',tasks:[]}));
    assert.throws(()=>parsePmOutcome({...report,outcome:'ready'}));
    assert.throws(()=>parsePmOutcome({...report,tasks:[{}]}));
    assert.equal(parsePmOutcome({...report,outcome:'execution_error'}).outcome,'execution_error');
    assert.equal(issueFingerprint(report.issues),issueFingerprint([{...report.issues[0],evidence:'正文 数量为2，清单为1'}]));
});

test('durable correction is idempotent, uses original Design, publishes only a new unapproved version and halts repeated issues',async()=>
{
    const pool=createPool();const c=await pool.connect();await c.query('BEGIN');
    const service={query:(s,p)=>c.query(s,p),connect:async()=>({query:(s,p)=>c.query(s==='BEGIN'?'SAVEPOINT revision_test':s==='COMMIT'?'RELEASE SAVEPOINT revision_test':s==='ROLLBACK'?'ROLLBACK TO SAVEPOINT revision_test':s,p),release:()=>{}})};
    let file;
    try
    {
        const key='REV-'+randomUUID();
        const project=(await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[key])).rows[0].id;
        const user=(await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        await c.query("INSERT INTO gameai.user_roles VALUES($1,$2,'Design')",[project,user]);
        const worker=(await c.query('INSERT INTO gameai.workers(project_id,worker_key,name,capacity,enabled) VALUES($1,$2,$2,1,true) RETURNING id',[project,hostname().toLowerCase()])).rows[0].id;
        const sessions={};
        for(const role of ['Design','PM'])
        {
            const agent=(await c.query('INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity) VALUES($1,$2,$2,$3,true,$2,1) RETURNING id',[project,role,worker])).rows[0].id;
            await c.query('INSERT INTO gameai.fixed_agents VALUES($1,$2,$3)',[project,role,agent]);
            sessions[role]=(await c.query("INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id,thread_id) VALUES($1,'TEST-REV',$2,$3,$4,$2) RETURNING id",[project,role,agent,worker])).rows[0].id;
        }
        async function proof(role,execution)
        {
            await c.query("INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state) VALUES($1,$2,$3,'completed')",[execution,sessions[role],'a'.repeat(64)]);
        }
        function payload(version,execution)
        {
            const html=htmlFixture(manifestFixture(1,version));
            return {request_id:randomUUID(),requirement_key:'TEST-REV',title:'修订测试',version,html,sha256:createHash('sha256').update(html).digest('hex'),execution_id:execution,thread_id:'Design',summary:'修正数量'};
        }
        await proof('Design','source-'+key);
        const original=await submitRequirement(service,key,payload('v1','source-'+key));
        const request={version_id:original.version_id,revision:original.revision,document_hash:original.document_hash};
        await reviewRequirement(service,key,user,{...request,decision:'approved',reason:''});
        const started=await startPmJob(service,key,user,request);await proof('PM',started.job.execution_id);
        const correction=await recordPmBlock(service,started.job,report);
        assert.equal(correction.state,'queued');
        assert.equal((await recordPmBlock(service,started.job,report)).id,correction.id);
        assert.equal((await startPmJob(service,key,user,request)).created,false);
        await assert.rejects(recordPmBlock(service,started.job,{...report,outcome:'execution_error'}));
        await c.query("UPDATE gameai.requirement_revisions SET state='running',started_at=now() WHERE id=$1",[correction.id]);
        await runRequirementRevision(service,correction,async()=>({code:1,output:'',diagnostics:'network failure'}));
        assert.equal((await c.query('SELECT state FROM gameai.requirement_revisions WHERE id=$1',[correction.id])).rows[0].state,'failed');
        assert.equal((await c.query('SELECT count(*) n FROM gameai.requirement_versions WHERE project_id=$1',[project])).rows[0].n,'1');
        await c.query("UPDATE gameai.requirement_revisions SET state='running' WHERE id=$1",[correction.id]);
        await runRequirementRevision(service,correction,async()=>({code:3,output:JSON.stringify({questions:['是否增加控件？']}),diagnostics:''}));
        assert.equal((await c.query('SELECT state FROM gameai.requirement_revisions WHERE id=$1',[correction.id])).rows[0].state,'needs_input');
        await c.query("UPDATE gameai.requirement_revisions SET state='running' WHERE id=$1",[correction.id]);
        await proof('Design','fix-'+key);
        const next=payload(correction.target_version,'fix-'+key);
        await mkdir(join(tempRoot,'design'),{recursive:true});file=join(tempRoot,'design',key+'.json');await writeFile(file,JSON.stringify(next));
        let calls=0;
        await runRequirementRevision(service,correction,async(args,command)=>
        {
            calls++;assert.deepEqual(command,['design','draft']);assert.ok(args.includes('TEST-REV'));
            return {code:0,output:JSON.stringify({status:'draft_saved',submission:file}),diagnostics:''};
        });
        assert.equal(calls,1);
        const saved=(await c.query('SELECT * FROM gameai.requirement_revisions WHERE id=$1',[correction.id])).rows[0];
        assert.equal(saved.state,'awaiting_approval',saved.error);
        assert.equal((await c.query('SELECT count(*) n FROM gameai.approvals WHERE version_id=$1',[saved.new_version_id])).rows[0].n,'0');
        assert.equal((await c.query('SELECT count(*) n FROM gameai.tasks WHERE project_id=$1',[project])).rows[0].n,'0');
        const receipt=await submitRequirement(service,key,next,correction.id);
        assert.equal(receipt.version_id,saved.new_version_id);
        const req2={version_id:receipt.version_id,revision:receipt.revision,document_hash:receipt.document_hash};
        await assert.rejects(startPmJob(service,key,user,req2),/批准/);
        await reviewRequirement(service,key,user,{...req2,decision:'approved',reason:''});
        const pm2=await startPmJob(service,key,user,req2);await proof('PM',pm2.job.execution_id);
        const repeated=await recordPmBlock(service,pm2.job,report);
        assert.equal(repeated.state,'needs_input');assert.match(repeated.error,/重复/);
        // A document question never becomes an automatic correction.
        await c.query('DELETE FROM gameai.requirement_revisions WHERE id=$1',[repeated.id]);
        const question=await recordPmBlock(service,pm2.job,{...report,outcome:'needs_input'});
        assert.equal(question.state,'needs_input');assert.match(question.error,/初稿/);
        // A third distinct issue still stops at the per-requirement two-round budget.
        await proof('Design','third-'+key);
        const third=await submitRequirement(service,key,payload('v3','third-'+key));
        const req3={version_id:third.version_id,revision:third.revision,document_hash:third.document_hash};
        await reviewRequirement(service,key,user,{...req3,decision:'approved',reason:''});
        const pm3=await startPmJob(service,key,user,req3);await proof('PM',pm3.job.execution_id);
        const limit=await recordPmBlock(service,pm3.job,{...report,issues:[{...report.issues[0],evidence:'另一处错误'}]});
        assert.equal(limit.state,'needs_input');assert.match(limit.error,/两轮/);
    }
    finally
    {
        await c.query('ROLLBACK');c.release();await pool.end();if(file) await rm(file,{force:true});
    }
});
