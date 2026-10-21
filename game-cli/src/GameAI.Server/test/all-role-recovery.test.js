import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {writeFile,unlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createPool} from '../src/database/connection.js';
import {projectRoot} from '../src/paths.js';
import {resumeTaskRepairs} from '../src/track/task-repair-flow.js';
import {enqueueTaskRepair} from '../src/database/task-repairs.js';
import {recoveryDecision} from '../src/database/task-recovery.js';
import {handoffUpstreamRepair,finishUpstreamRepair,requestUpstreamRepair} from '../src/database/upstream-repairs.js';
import {loadTaskContext} from '../src/database/qa-context.js';
import {resumeRoleJobs} from '../src/track/role-job-recovery.js';
import {validateRoleOperationClaim} from '../src/database/role-operation-claims.js';
import {designExecutionIds,recoveryInstructions} from '../src/database/recovery-protocol.js';
import {inspectInterruptedTasks} from '../src/track/recovery-watchdog.js';
import {recoverStoppedAgents,verifyStopReceipt} from '../src/track/agent-stop-recovery.js';

async function fixture(action)
{
    const pool=createPool();
    const c=await pool.connect();
    const file='game-cli/temp/all-role-recovery-'+randomUUID()+'.txt';
    await mkdir(join(projectRoot,'game-cli/temp'),{recursive:true});
    await writeFile(join(projectRoot,file),'real failure evidence');
    const artifacts=[{path:file,sha256:createHash('sha256').update('real failure evidence').digest('hex')}];
    await c.query('BEGIN');
    const service={query:(sql,args)=>c.query(sql,args),connect:async()=>({query:(sql,args)=>
    {
        if (sql==='BEGIN') return c.query('SAVEPOINT service_recovery');
        if (sql==='COMMIT') return c.query('RELEASE SAVEPOINT service_recovery');
        if (sql==='ROLLBACK') return c.query('ROLLBACK TO SAVEPOINT service_recovery');
        return c.query(sql,args);
    },release(){}})};
    try
    {
        const project=(await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',['ALL-ROLE-'+randomUUID()])).rows[0].id;
        const user=(await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        const worker=(await c.query("INSERT INTO gameai.workers(project_id,worker_key,name,capacity,enabled) VALUES($1,'isolated','test',1,true) RETURNING id",[project])).rows[0].id;
        const agents={};
        for (const role of ['Design','PM','Prefab','Art','Development','QA'])
        {
            agents[role]=(await c.query(`INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity,auto_execute)
                VALUES($1,$2,$2,$3,true,$2,1,true) RETURNING id`,[project,role,worker])).rows[0].id;
            await c.query('INSERT INTO gameai.fixed_agents VALUES($1,$2,$3)',[project,role,agents[role]]);
        }
        const requirement=(await c.query("INSERT INTO gameai.requirements(project_id,requirement_key,title) VALUES($1,'TEST','test') RETURNING id",[project])).rows[0].id;
        const version=(await c.query("INSERT INTO gameai.requirement_versions(project_id,requirement_id,version,ordinal,content,content_hash) VALUES($1,$2,'v1',1,'{}',$3) RETURNING id",[project,requirement,'0'.repeat(64)])).rows[0].id;
        await c.query("INSERT INTO gameai.user_roles VALUES($1,$2,'Design')",[project,user]);
        await c.query("INSERT INTO gameai.approvals(project_id,version_id,user_id,decision) VALUES($1,$2,$3,'approved')",[project,version,user]);
        const plan=(await c.query('INSERT INTO gameai.plans(project_id,requirement_id) VALUES($1,$2) RETURNING id',[project,requirement])).rows[0].id;
        const pv=(await c.query("INSERT INTO gameai.plan_versions(project_id,plan_id,requirement_version_id,version,state) VALUES($1,$2,$3,1,'published') RETURNING id",[project,plan,version])).rows[0].id;
        const parent=(await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code) VALUES($1,$2,'parent','PM') RETURNING id",[project,pv])).rows[0].id;
        await c.query("INSERT INTO gameai.plan_dispatch_flows(plan_version_id,project_id,requested_by,state,reason) VALUES($1,$2,$3,'active','')",[pv,project,user]);
        async function task(role,status='failed')
        {
            return (await c.query(`INSERT INTO gameai.tasks(project_id,plan_version_id,parent_id,title,role_code,status,dispatch_allowed,dispatch_selected_by,dispatch_selected_at)
                VALUES($1,$2,$3,$4,$4,$5,true,$6,now()) RETURNING *`,[project,pv,parent,role,status,user])).rows[0];
        }
        async function execution(task,state='failed',result={})
        {
            return (await c.query(`INSERT INTO gameai.executions(project_id,task_id,agent_id,state,result,started_at)
                VALUES($1,$2,$3,$4,$5,clock_timestamp()) RETURNING id`,[project,task.id,agents[task.role_code],state,result])).rows[0].id;
        }
        async function queue(task,id,failure,context={})
        {
            const error='technical diagnosis';
            await c.query('UPDATE gameai.executions SET result=$2 WHERE id=$1',[id,{error,failure,artifacts}]);
            await c.query("INSERT INTO gameai.task_dispatch_jobs(execution_id,project_id,requested_by,requirement_key,input_hash,context) VALUES($1,$2,$3,'TEST',$4,$5)",[id,project,user,'0'.repeat(64),context]);
            return enqueueTaskRepair(c,task,id,recoveryDecision({state:'failed',error,failure,attempts:1,authorized:true}),{error,failure,context,result:{artifacts}});
        }
        await action({c,service,project,user,worker,agents,requirement,version,pv,parent,file,artifacts,task,execution,queue});
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
        await unlink(join(projectRoot,file));
    }
}

test('all specialist roles enter the same durable diagnosis and retain original task/Agent',()=>fixture(async f=>
{
    for (const role of ['Prefab','Art','Development','QA'])
    {
        const task=await f.task(role);
        const id=await f.execution(task);
        await f.queue(task,id,{code:'TASK_VALIDATION_FAILED'});
        if (role==='Development')
        {
            await f.c.query('UPDATE gameai.agents SET auto_execute=false WHERE id=$1',[f.agents[role]]);
            await resumeTaskRepairs(f.service,{projectId:f.project});
            assert.equal((await f.c.query('SELECT code FROM gameai.task_repairs WHERE execution_id=$1',[id])).rows[0].code,'awaiting_authorization');
            await f.c.query('UPDATE gameai.agents SET auto_execute=true WHERE id=$1',[f.agents[role]]);
        }
        await resumeTaskRepairs(f.service,{projectId:f.project});
        const row=(await f.c.query('SELECT * FROM gameai.task_repairs WHERE execution_id=$1',[id])).rows[0];
        assert.equal(row.state,'ready',role);
        assert.equal(row.task_id,task.id);
        assert.equal((await f.c.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[task.id])).rows[0].n,1);
        await f.c.query("UPDATE gameai.task_repairs SET state='resolved' WHERE execution_id=$1",[id]);
    }
    assert.match(recoveryInstructions,/原完整验收/);
}));

test('upstream handoff is evidence-bound, idempotent and wakes original consumer after a new accepted delivery',()=>fixture(async f=>
{
    const source=await f.task('Art','completed');
    const consumer=await f.task('Prefab');
    const original=await f.execution(source,'succeeded',{artifacts:f.artifacts});
    await f.c.query('INSERT INTO gameai.task_dependencies(project_id,task_id,depends_on_id) VALUES($1,$2,$3)',[f.project,consumer.id,source.id]);
    const context=await loadTaskContext(f.c,consumer);
    const failure={code:'UPSTREAM_INVALID',items:[{source_task_key:source.task_key,evidence_path:f.file,step:'binding',repair:'repair approved asset'}]};
    const id=await f.execution(consumer);
    const queued=await f.queue(consumer,id,failure,context);
    const row={project_id:f.project,plan_version_id:f.pv,task_id:consumer.id,execution_id:id,context,failure,result:{artifacts:f.artifacts},decision:queued.decision};
    assert.equal((await handoffUpstreamRepair(f.c,{...row,result:{artifacts:[]}})).attention,true);
    assert.equal((await handoffUpstreamRepair(f.c,{...row,failure:{...failure,items:[{...failure.items[0],source_task_key:'OTHER'}]}})).attention,true);
    await f.c.query('UPDATE gameai.agents SET auto_execute=false WHERE id=$1',[f.agents.Art]);
    assert.equal((await handoffUpstreamRepair(f.c,row)).attention,true);
    await f.c.query('UPDATE gameai.agents SET auto_execute=true WHERE id=$1',[f.agents.Art]);
    const receipt=await requestUpstreamRepair(f.service,row);
    assert.equal(receipt.handedOff,true);
    assert.equal((await handoffUpstreamRepair(f.c,row)).handedOff,true);
    assert.equal((await f.c.query('SELECT count(*)::int n FROM gameai.upstream_repairs WHERE project_id=$1',[f.project])).rows[0].n,1);
    const changed=(await f.c.query('SELECT status,bound_agent_id FROM gameai.tasks WHERE id=$1',[source.id])).rows[0];
    assert.equal(changed.status,'pending');
    assert.equal(changed.bound_agent_id,f.agents.Art);
    await f.c.query("UPDATE gameai.task_repairs SET state='waiting' WHERE execution_id=$1",[id]);
    await resumeTaskRepairs(f.service,{projectId:f.project,handoff:async()=>receipt});
    assert.equal((await f.c.query('SELECT state FROM gameai.task_repairs WHERE execution_id=$1',[id])).rows[0].state,'waiting','accepted old delivery cannot resolve defect');
    // A source failure owns the pause. Consumer polling must not steal that pause
    // or become an abandoned attention row while the source is being repaired.
    await f.c.query("UPDATE gameai.tasks SET status='failed' WHERE id=$1",[source.id]);
    const sourceFailure=await f.execution(source);
    const sourceQueue=await f.queue(source,sourceFailure,{code:'TASK_VALIDATION_FAILED'});
    await f.c.query("UPDATE gameai.plan_dispatch_flows SET state='paused',reason=$2 WHERE plan_version_id=$1",[f.pv,'自动恢复处理中：'+sourceQueue.decision.reason]);
    await f.c.query("UPDATE gameai.task_repairs SET next_attempt_at=now()-interval '1 minute' WHERE execution_id=$1",[id]);
    await resumeTaskRepairs(f.service,{projectId:f.project});
    assert.equal((await f.c.query('SELECT state FROM gameai.task_repairs WHERE execution_id=$1',[id])).rows[0].state,'waiting');
    assert.equal((await f.c.query('SELECT reason FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[f.pv])).rows[0].reason,'自动恢复处理中：'+sourceQueue.decision.reason);
    await resumeTaskRepairs(f.service,{projectId:f.project});
    assert.equal((await f.c.query('SELECT state FROM gameai.task_repairs WHERE execution_id=$1',[sourceFailure])).rows[0].state,'ready');
    await f.c.query("UPDATE gameai.task_repairs SET state='resolved' WHERE execution_id=$1",[sourceFailure]);
    const repaired=await f.execution(source,'succeeded',{artifacts:f.artifacts});
    await f.c.query("UPDATE gameai.tasks SET status='completed' WHERE id=$1",[source.id]);
    await finishUpstreamRepair(f.c,source,repaired);
    await resumeTaskRepairs(f.service,{projectId:f.project});
    assert.equal((await f.c.query('SELECT state FROM gameai.task_repairs WHERE execution_id=$1',[id])).rows[0].state,'ready');
    let link=(await f.c.query('SELECT * FROM gameai.upstream_repairs WHERE project_id=$1',[f.project])).rows[0];
    assert.equal(link.state,'repaired');
    assert.equal(link.source_execution_id,original);
    await finishUpstreamRepair(f.c,consumer,await f.execution(consumer,'succeeded',{artifacts:f.artifacts}));
    link=(await f.c.query('SELECT * FROM gameai.upstream_repairs WHERE project_id=$1',[f.project])).rows[0];
    assert.equal(link.state,'verified');
    await f.c.query("UPDATE gameai.plan_dispatch_flows SET state='paused',reason='人工暂停' WHERE plan_version_id=$1",[f.pv]);
    assert.equal((await requestUpstreamRepair(f.service,row)).attention,true,'manual pause cannot be overridden');
}));

test('Design and PM recover their own durable jobs; unknown processes, revoked consent and spent budgets never duplicate execution',()=>fixture(async f=>
{
    const pm=(await f.c.query(`INSERT INTO gameai.pm_jobs(project_id,requirement_version_id,execution_id,requested_by,revision,document_hash,state,recovery_agent_id,error,recovery_code)
        VALUES($1,$2,$3,$4,$5,$5,'failed',$6,'injected transport failure','technical_failure') RETURNING *`,[f.project,f.version,randomUUID().replaceAll('-',''),f.user,'0'.repeat(64),f.agents.PM])).rows[0];
    await f.c.query("INSERT INTO gameai.approval_workflows(version_id,project_id,requested_by,revision,document_hash,state) VALUES($1,$2,$3,$4,$4,'failed')",[f.version,f.project,f.user,'0'.repeat(64)]);
    await resumeRoleJobs(f.service,{projectId:f.project});
    assert.equal((await f.c.query('SELECT state FROM gameai.approval_workflows WHERE version_id=$1',[f.version])).rows[0].state,'queued');
    assert.equal((await f.c.query('SELECT attempts FROM gameai.pm_jobs WHERE id=$1',[pm.id])).rows[0].attempts,1);
    const operation=randomUUID().replaceAll('-','');
    const design=(await f.c.query(`INSERT INTO gameai.requirement_revisions(project_id,source_version_id,pm_job_id,design_agent_id,report,fingerprint,round,target_version,state,error,recovery_execution_id,recovery_attempts)
        VALUES($1,$2,$3,$4,'{}','test',1,'v1-fix1','failed','tool failure',$5,1) RETURNING *`,[f.project,f.version,pm.id,f.agents.Design,operation])).rows[0];
    const conversation=(await f.c.query("INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id) VALUES($1,'TEST','Design',$2,$3) RETURNING id",[f.project,f.agents.Design,f.worker])).rows[0].id;
    const executionId=designExecutionIds(operation)[0];
    await f.c.query("INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state) VALUES($1,$2,$3,'unknown')",[executionId,conversation,'0'.repeat(64)]);
    await resumeRoleJobs(f.service,{projectId:f.project});
    assert.equal((await f.c.query('SELECT state FROM gameai.requirement_revisions WHERE id=$1',[design.id])).rows[0].state,'failed');
    await f.c.query("UPDATE gameai.agent_runs SET state='failed',finished_at=now() WHERE execution_id=$1",[executionId]);
    await f.c.query('UPDATE gameai.agents SET auto_execute=false WHERE id=$1',[f.agents.Design]);
    await resumeRoleJobs(f.service,{projectId:f.project});
    assert.equal((await f.c.query('SELECT state FROM gameai.requirement_revisions WHERE id=$1',[design.id])).rows[0].state,'failed');
    await f.c.query('UPDATE gameai.agents SET auto_execute=true WHERE id=$1',[f.agents.Design]);
    await resumeRoleJobs(f.service,{projectId:f.project});
    assert.equal((await f.c.query('SELECT state FROM gameai.requirement_revisions WHERE id=$1',[design.id])).rows[0].state,'queued');
    await assert.rejects(validateRoleOperationClaim(f.c,f.project,{role:'Design',execution_id:executionId},f.agents.Design),/迟到/);
    await f.c.query("UPDATE gameai.requirement_revisions SET state='failed',recovery_attempts=3,recovery_at=now() WHERE id=$1",[design.id]);
    await resumeRoleJobs(f.service,{projectId:f.project});
    assert.equal((await f.c.query('SELECT state FROM gameai.requirement_revisions WHERE id=$1',[design.id])).rows[0].state,'failed');
    assert.equal((await f.c.query("SELECT count(*)::int n FROM gameai.audit_events WHERE project_id=$1 AND event='角色恢复需要维护处理'",[f.project])).rows[0].n,1);
}));

test('watchdog recovers original successful output, releases an unclaimed expired reservation and never duplicates an unknown process',()=>fixture(async f=>
{
    const conversation=(await f.c.query("INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id,thread_id) VALUES($1,'TEST','Development',$2,$3,'test') RETURNING id",[f.project,f.agents.Development,f.worker])).rows[0].id;
    async function interrupted(state,proof)
    {
        const task=await f.task('Development','running');
        const id=await f.execution(task,state);
        const prompt='{}';
        const hash=createHash('sha256').update(prompt).digest('hex');
        const job={executionId:id,projectId:f.project,taskId:task.id,planVersionId:f.pv,role:'Development',prompt,key:'TEST'};
        await f.c.query("UPDATE gameai.executions SET started_at=now()-interval '5 minutes' WHERE id=$1",[id]);
        await f.c.query(`INSERT INTO gameai.task_dispatch_jobs(execution_id,project_id,requested_by,requirement_key,input_hash,context,expires_at)
            VALUES($1,$2,$3,'TEST',$4,$5,now()-interval '2 minutes')`,[id,f.project,f.user,hash,await loadTaskContext(f.c,task)]);
        await f.c.query('INSERT INTO gameai.task_publications(execution_id,job) VALUES($1,$2)',[id,job]);
        if (proof)
        {
            await f.c.query(`INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state,finished_at)
                VALUES($1,$2,$3,$4,now()-interval '3 minutes')`,[id.replaceAll('-',''),conversation,hash,proof]);
        }
        return {task,id,hash};
    }
    const success=await interrupted('running','completed');
    const result={InputSha256:success.hash,Text:JSON.stringify({verdict:'pass',summary:'recovered output',deliverables:['test'],files:[f.file],questions:[],checks:[{name:'actual content',passed:true,evidence_path:f.file}]})};
    await inspectInterruptedTasks(f.service,{projectId:f.project,read:async()=>JSON.stringify(result)});
    assert.equal((await f.c.query('SELECT state FROM gameai.executions WHERE id=$1',[success.id])).rows[0].state,'succeeded');
    assert.equal((await f.c.query('SELECT status FROM gameai.tasks WHERE id=$1',[success.task.id])).rows[0].status,'completed');
    const missing=async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});};
    const unclaimed=await interrupted('assigned',null);
    await inspectInterruptedTasks(f.service,{projectId:f.project,read:missing});
    assert.equal((await f.c.query('SELECT state FROM gameai.executions WHERE id=$1',[unclaimed.id])).rows[0].state,'failed');
    assert.equal((await f.c.query('SELECT state FROM gameai.task_repairs WHERE execution_id=$1',[unclaimed.id])).rows[0].state,'pending');
    const unknown=await interrupted('unknown','unknown');
    await inspectInterruptedTasks(f.service,{projectId:f.project,read:missing});
    await inspectInterruptedTasks(f.service,{projectId:f.project,read:missing});
    assert.equal((await f.c.query('SELECT state FROM gameai.executions WHERE id=$1',[unknown.id])).rows[0].state,'unknown');
    assert.equal((await f.c.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[unknown.task.id])).rows[0].n,1);
    assert.equal((await f.c.query("SELECT count(*)::int n FROM gameai.audit_events WHERE project_id=$1 AND event='巡检发现执行中断'",[f.project])).rows[0].n,1);
}));

test('signed stop receipts recover all-role capacity after disconnect; forged and cross-execution receipts cannot release a lease',()=>fixture(async f=>
{
    const key='isolated-test-secret';
    for (const role of ['Design','PM','Prefab','Art','Development','QA'])
    {
        const executionId=randomUUID().replaceAll('-','');
        const conversation=(await f.c.query(`INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id)
            VALUES($1,'TEST',$2,$3,$4) RETURNING id`,[f.project,role,f.agents[role],f.worker])).rows[0].id;
        await f.c.query(`INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state,started_at,expires_at)
            VALUES($1,$2,$3,'unknown',now()-interval '2 minutes',now()-interval '1 minute')`,[executionId,conversation,'0'.repeat(64)]);
        const payload=JSON.stringify({execution_id:executionId,worker_key:'isolated',state:'failed',stopped_at:new Date().toISOString()});
        const signed={payload,signature:createHmac('sha256',key).update(payload).digest('hex')};
        const read=async path=>path.endsWith('client.json') ? JSON.stringify({token:key,worker_key:'isolated'}) : JSON.stringify(signed);
        const run={execution_id:executionId,worker_key:'isolated',started_at:new Date(Date.now()-120000)};
        assert.equal(verifyStopReceipt(JSON.stringify(signed),key,run).state,'failed');
        assert.throws(()=>verifyStopReceipt(JSON.stringify({...signed,payload:payload.replace('failed','completed')}),key,run),/签名/);
        assert.throws(()=>verifyStopReceipt(JSON.stringify(signed),key,{...run,execution_id:'a'.repeat(32)}),/不匹配/);
        await recoverStoppedAgents(f.service,{projectId:f.project,read});
        assert.equal((await f.c.query('SELECT state FROM gameai.agent_runs WHERE execution_id=$1',[executionId])).rows[0].state,'failed',role);
    }
}));

test('a final-message checkpoint survives cloud acknowledgement loss without being treated as a successful delivery',()=>fixture(async f=>
{
    const task=await f.task('Development','running');
    const id=await f.execution(task,'running');
    const hash=createHash('sha256').update('{}').digest('hex');
    const job={executionId:id,projectId:f.project,taskId:task.id,planVersionId:f.pv,role:'Development',prompt:'{}',key:'TEST'};
    const conversation=(await f.c.query("INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id) VALUES($1,'TEST','Development',$2,$3) RETURNING id",[f.project,f.agents.Development,f.worker])).rows[0].id;
    await f.c.query("UPDATE gameai.executions SET started_at=now()-interval '5 minutes' WHERE id=$1",[id]);
    await f.c.query(`INSERT INTO gameai.task_dispatch_jobs(execution_id,project_id,requested_by,requirement_key,input_hash,context)
        VALUES($1,$2,$3,'TEST',$4,$5)`,[id,f.project,f.user,hash,await loadTaskContext(f.c,task)]);
    await f.c.query('INSERT INTO gameai.task_publications(execution_id,job) VALUES($1,$2)',[id,job]);
    await f.c.query(`INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state,finished_at)
        VALUES($1,$2,$3,'failed',now()-interval '1 minute')`,[id.replaceAll('-',''),conversation,hash]);
    const directory=join(projectRoot,'game-cli/temp/agent-checkpoints');
    const path=join(directory,id.replaceAll('-','')+'.json');
    await mkdir(directory,{recursive:true});
    await writeFile(path,JSON.stringify({InputSha256:hash,Text:JSON.stringify({verdict:'pass',summary:'saved before acknowledgement',deliverables:['checkpoint'],files:[f.file],questions:[],checks:[{name:'original evidence',passed:true,evidence_path:f.file}]})}));
    try
    {
        await inspectInterruptedTasks(f.service,{projectId:f.project,read:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}});
        const execution=(await f.c.query('SELECT * FROM gameai.executions WHERE id=$1',[id])).rows[0];
        assert.equal(execution.state,'failed');
        assert.match(execution.result.result.Text,/saved before acknowledgement/);
        assert.deepEqual(execution.result.artifacts,f.artifacts);
        assert.equal((await f.c.query('SELECT status FROM gameai.tasks WHERE id=$1',[task.id])).rows[0].status,'failed');
    }
    finally
    {
        await unlink(path);
    }
}));
