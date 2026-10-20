import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../src/database/connection.js';
import {enqueueTaskRepair} from '../src/database/task-repairs.js';
import {recoveryDecision} from '../src/database/task-recovery.js';
import {resumeTaskRepairs} from '../src/track/task-repair-flow.js';
import {refreshTaskAggregates} from '../src/track/task-flow.js';

test('PostgreSQL recovery leases, restart recovery, environment waits, revocation and no-progress detection',async()=>
{
    const pool=createPool();
    const c=await pool.connect();
    await c.query('BEGIN');
    try
    {
        const p=(await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',['REPAIR-'+randomUUID()])).rows[0].id;
        const user=(await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        const worker=(await c.query("INSERT INTO gameai.workers(project_id,worker_key,name,capacity,enabled) VALUES($1,'isolated','test',1,true) RETURNING id",[p])).rows[0].id;
        const agent=(await c.query("INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity,auto_execute) VALUES($1,'isolated','Art',$2,true,'test',1,true) RETURNING id",[p,worker])).rows[0].id;
        const requirement=(await c.query("INSERT INTO gameai.requirements(project_id,requirement_key,title) VALUES($1,'TEST','test') RETURNING id",[p])).rows[0].id;
        const version=(await c.query("INSERT INTO gameai.requirement_versions(project_id,requirement_id,version,ordinal,content,content_hash) VALUES($1,$2,'v1',1,'{}',$3) RETURNING id",[p,requirement,'0'.repeat(64)])).rows[0].id;
        const plan=(await c.query('INSERT INTO gameai.plans(project_id,requirement_id) VALUES($1,$2) RETURNING id',[p,requirement])).rows[0].id;
        const pv=(await c.query('INSERT INTO gameai.plan_versions(project_id,plan_id,requirement_version_id,version) VALUES($1,$2,$3,1) RETURNING id',[p,plan,version])).rows[0].id;
        const parent=(await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code) VALUES($1,$2,'parent','PM') RETURNING id",[p,pv])).rows[0].id;
        await c.query("INSERT INTO gameai.plan_dispatch_flows(plan_version_id,project_id,requested_by,state,reason,agent_policy) VALUES($1,$2,$3,'paused','自动恢复处理中：test',$4)",[pv,p,user,JSON.stringify([{id:agent,role_code:'Art'}])]);
        async function failure(error='CONTRACT_CONFLICT: two redundant entries',structured=null)
        {
            const task=(await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code,status,dispatch_allowed,dispatch_selected_by,dispatch_selected_at,parent_id) VALUES($1,$2,'test','Art','failed',true,$3,now(),$4) RETURNING *",[p,pv,user,parent])).rows[0];
            const execution=(await c.query("INSERT INTO gameai.executions(project_id,task_id,agent_id,state,result) VALUES($1,$2,$3,'failed',$4) RETURNING id",[p,task.id,agent,{error,failure:structured}])).rows[0].id;
            await c.query("INSERT INTO gameai.task_dispatch_jobs(execution_id,project_id,requested_by,requirement_key,input_hash,context) VALUES($1,$2,$3,'TEST',$4,'{}')",[execution,p,user,'0'.repeat(64)]);
            const decision=recoveryDecision({state:'failed',error,attempts:1,authorized:true});
            await enqueueTaskRepair(c,task,execution,decision,{error,failure:structured,context:{input_hash:'0'.repeat(64)}});
            await c.query("UPDATE gameai.plan_dispatch_flows SET state='paused',reason='自动恢复处理中：test' WHERE plan_version_id=$1",[pv]);
            return {task,execution};
        }
        const read=async id=>(await c.query('SELECT * FROM gameai.task_repairs WHERE execution_id=$1',[id])).rows[0];
        const first=await failure();
        let calls=0;
        const options={projectId:p,guard:async()=>{calls++;return {applicable:true,runtimeValidated:true};}};
        // Simulate a server dying after claim. The next process reclaims the expired DB lease.
        await c.query("UPDATE gameai.task_repairs SET state='diagnosing',lease_until=now()-interval '1 second' WHERE execution_id=$1",[first.execution]);
        await Promise.all([resumeTaskRepairs(c,options),resumeTaskRepairs(c,options)]);
        assert.equal(calls,1);
        assert.equal((await read(first.execution)).state,'ready');
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.workflow_outbox WHERE event_key=$1',['repair:'+first.execution])).rows[0].n,1);
        await c.query("UPDATE gameai.task_repairs SET state='resolved' WHERE execution_id=$1",[first.execution]);

        const waiting=await failure('TOOL_UNAVAILABLE: Unity bridge unavailable');
        await resumeTaskRepairs(c,{projectId:p,environment:async()=>false});
        assert.equal((await read(waiting.execution)).state,'waiting');
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[waiting.task.id])).rows[0].n,1,'environment probes never start a new production execution');
        await c.query('UPDATE gameai.task_repairs SET next_attempt_at=now() WHERE execution_id=$1',[waiting.execution]);
        await resumeTaskRepairs(c,{projectId:p,environment:async()=>true});
        assert.equal((await read(waiting.execution)).state,'ready');
        await c.query("UPDATE gameai.task_repairs SET state='resolved' WHERE execution_id=$1",[waiting.execution]);

        const denied=await failure();
        await c.query('UPDATE gameai.agents SET auto_execute=false WHERE id=$1',[agent]);
        await resumeTaskRepairs(c,options);
        assert.equal((await read(denied.execution)).state,'attention');
        assert.equal(calls,1,'revoked grants cannot invoke even the repair handler');
        await c.query('UPDATE gameai.agents SET auto_execute=true WHERE id=$1',[agent]);

        const same=await failure('unrecognized deterministic error');
        const again=(await c.query("INSERT INTO gameai.executions(project_id,task_id,agent_id,state,result,started_at) VALUES($1,$2,$3,'failed',$4,now()+interval '1 second') RETURNING id",[p,same.task.id,agent,{error:'unrecognized deterministic error'}])).rows[0].id;
        const repeat=await enqueueTaskRepair(c,same.task,again,recoveryDecision({state:'failed',error:'unrecognized deterministic error',attempts:2,authorized:true}),{error:'unrecognized deterministic error',context:{input_hash:'0'.repeat(64)}});
        assert.equal(repeat.state,'attention');
        assert.equal(repeat.decision.code,'no_progress');
        await resumeTaskRepairs(c,options);
        assert.equal((await read(same.execution)).state,'cancelled','stale work cannot revive an older execution');

        const fixed=await failure('装配参数中的历史贴图清单未修复',{code:'UPSTREAM_INVALID'});
        for (let index=1;index<=2;index++) await c.query("INSERT INTO gameai.executions(project_id,task_id,agent_id,state,started_at) VALUES($1,$2,$3,'failed',now()-$4*interval '1 second')",[p,fixed.task.id,agent,index]);
        const verified={projectId:p,guard:async()=>({applicable:true,runtimeValidated:true,handlerFingerprint:'b'.repeat(64)})};
        await resumeTaskRepairs(c,verified);
        assert.equal((await read(fixed.execution)).state,'ready');
        assert.equal((await read(fixed.execution)).evidence.budget.prior_attempts,3);
        await c.query("UPDATE gameai.task_repairs SET state='pending',next_attempt_at=now() WHERE execution_id=$1",[fixed.execution]);
        await resumeTaskRepairs(c,verified);
        assert.equal((await read(fixed.execution)).state,'attention','same verified handler cannot reset its budget again');
        assert.match((await read(fixed.execution)).decision.reason,/预算已用尽/);
        const summary=(await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code) VALUES($1,$2,'summary','PM') RETURNING id",[p,pv])).rows[0].id;
        await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code,status,parent_id) VALUES($1,$2,'done','Art','completed',$3)",[p,pv,summary]);
        const review=(await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code,status,parent_id) VALUES($1,$2,'review','Art','review',$3) RETURNING id",[p,pv,summary])).rows[0].id;
        await refreshTaskAggregates(c,pv);
        let aggregate=(await c.query('SELECT status,progress FROM gameai.tasks WHERE id=$1',[summary])).rows[0];
        assert.deepEqual(aggregate,{status:'review',progress:50});
        await c.query("UPDATE gameai.tasks SET status='completed' WHERE id=$1",[review]);
        await refreshTaskAggregates(c,pv);
        aggregate=(await c.query('SELECT status,progress FROM gameai.tasks WHERE id=$1',[summary])).rows[0];
        assert.deepEqual(aggregate,{status:'completed',progress:100});
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
