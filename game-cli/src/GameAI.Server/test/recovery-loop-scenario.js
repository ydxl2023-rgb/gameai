import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot} from '../src/paths.js';
import {dispatchTasks} from '../src/database/task-dispatch.js';
import {runTaskDispatch,finishReceivedTask} from '../src/track/task-dispatch.js';
import {continueTaskFlow} from '../src/track/task-flow.js';
import {readCollaboration} from '../src/database/collaboration.js';
import {resumeTaskRepairs} from '../src/track/task-repair-flow.js';

// Real PostgreSQL, guards, task runner and collaboration trigger; only the model is simulated.
export async function recoveryLoopScenario({c,servicePool,p,worker,user,key,rows})
{
    await c.query('SAVEPOINT recovery_loop');
    const evidence='game-cli/temp/recovery-test-'+randomUUID()+'.txt';
    const path=join(projectRoot,evidence);
    await mkdir(join(projectRoot,'game-cli/temp'),{recursive:true});
    try
    {
        const task=rows.find(t=>t.delivery_phase==='whitebox');
        assert.ok(task);
        const agent=(await c.query(`INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity,auto_execute)
            VALUES($1,'prefab-test','Prefab',$2,true,'隔离恢复测试',1,true) RETURNING id`,[p,worker])).rows[0].id;
        await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'Prefab',$2)",[p,agent]);
        await c.query("INSERT INTO gameai.agent_grants(project_id,agent_id,permission_code) VALUES($1,$2,'task.write_assigned')",[p,agent]);
        await c.query(`INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,is_primary,content_hash)
            SELECT $1,$2,skill_key,true,content_hash FROM gameai.skills WHERE skill_key='prefab/PrefabAgent01'`,[p,agent]);
        await c.query("UPDATE gameai.plan_dispatch_flows SET state='active',agent_policy=NULL WHERE plan_version_id=$1",[task.plan_version_id]);
        await c.query('UPDATE gameai.tasks SET dispatch_allowed=true,dispatch_selected_by=$2,dispatch_selected_at=now() WHERE id=$1',[task.id,user]);
        const conversation=(await c.query(`INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id,thread_id)
            VALUES($1,'TEST-UI','Prefab',$2,$3,'recovery-test-thread') RETURNING id`,[p,agent,worker])).rows[0].id;
        let calls=0;
        let failAlways=false;
        const execute=async(args)=>
        {
            calls++;
            const prompt=await readFile(args[args.indexOf('--prompt-file')+1],'utf8');
            const input=JSON.parse(prompt);
            const hash=createHash('sha256').update(prompt).digest('hex');
            const id=args[args.indexOf('--execution-id')+1];
            if (calls>1)
            {
                assert.match(input.failure_context.error,/专业交付检查/);
                assert.match(input.failure_context.previous_result,/故障注入/);
                assert.match(input.failure_context.instruction,/先复现上次失败/);
                assert.ok(input.failure_context.collaboration_feedback.some(m=>m.event==='任务失败，已进入自动诊断修复'));
                assert.ok(input.failure_context.collaboration_feedback.some(m=>m.body.includes('故障注入')));
            }
            await c.query(`INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state,finished_at)
                VALUES($1,$2,$3,'completed',now())`,[id.replaceAll('-',''),conversation,hash]);
            const failed=failAlways || calls===1;
            await writeFile(path,failed?'BROKEN':'FIXED');
            const result={verdict:failed?'fail':'pass',summary:failed?'故障注入：文件内容错误':'依据失败上下文修正文件',deliverables:['隔离测试文件'],files:[evidence],questions:[],checks:[{name:'文件内容检查',passed:!failed,evidence_path:evidence}]};
            return {code:0,diagnostics:'isolated deterministic executor',output:JSON.stringify({InputSha256:hash,Text:JSON.stringify(result)})};
        };
        await c.query('SAVEPOINT recovery_cases');
        const request={tasks:[{task_id:task.id,revision:task.dispatch_revision}]};
        const started=await dispatchTasks(servicePool,key,user,request,true,true);
        assert.equal(started.jobs.length,1,JSON.stringify(started.rows));
        await runTaskDispatch(servicePool,started.jobs[0],execute);
        assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[task.id])).rows[0].status,'failed');
        let history=await readCollaboration(servicePool,key);
        assert.ok(history.messages.some(m=>m.event==='任务失败，已进入自动诊断修复'));
        assert.ok(history.messages.some(m=>m.body.includes('文件内容错误') && m.body.includes('文件内容检查')));
        await resumeTaskRepairs(servicePool,{projectId:p});
        await continueTaskFlow(servicePool,task.plan_version_id,execute);
        assert.equal(calls,2);
        assert.equal(await readFile(path,'utf8'),'FIXED');
        assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[task.id])).rows[0].status,'completed');
        assert.deepEqual((await c.query('SELECT state FROM gameai.executions WHERE task_id=$1 ORDER BY started_at',[task.id])).rows.map(r=>r.state),['failed','succeeded']);
        history=await readCollaboration(servicePool,key);
        for (const event of ['任务失败，已进入自动诊断修复','编排器自动派发专业任务','工程交付校验通过，通知后续任务'])
        {
            assert.ok(history.messages.some(m=>m.event===event),'Missing collaboration event: '+event);
        }
        await c.query('ROLLBACK TO SAVEPOINT recovery_cases');
        calls=0;
        failAlways=true;
        await continueTaskFlow(servicePool,task.plan_version_id,execute);
        await resumeTaskRepairs(servicePool,{projectId:p});
        await continueTaskFlow(servicePool,task.plan_version_id,execute);
        assert.equal(calls,2);
        assert.equal((await c.query('SELECT state FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[task.plan_version_id])).rows[0].state,'paused');
        const last=(await c.query('SELECT result FROM gameai.executions WHERE task_id=$1 ORDER BY started_at DESC LIMIT 1',[task.id])).rows[0];
        assert.equal(last.result.recovery.code,'no_progress');
        history=await readCollaboration(servicePool,key);
        assert.ok(history.messages.some(m=>m.event==='任务自动修复需要处理'));

        await c.query('ROLLBACK TO SAVEPOINT recovery_cases');
        const preflight=await dispatchTasks(servicePool,key,user,request,true,true);
        const invalid={...preflight.jobs[0],prompt:JSON.stringify({...JSON.parse(preflight.jobs[0].prompt),approved_document:null})};
        await runTaskDispatch(servicePool,invalid,async()=>assert.fail('pre-claim failure cannot start an Agent'));
        assert.equal((await c.query('SELECT state FROM gameai.executions WHERE id=$1',[invalid.executionId])).rows[0].state,'failed','host failure before claim must release capacity without forged process proof');
        assert.equal((await c.query('SELECT 1 FROM gameai.agent_runs WHERE execution_id=$1',[invalid.executionId.replaceAll('-','')])).rowCount,0);

        await c.query('ROLLBACK TO SAVEPOINT recovery_cases');
        const interrupted=await dispatchTasks(servicePool,key,user,request,true,true);
        const unknownJob=interrupted.jobs[0];
        await runTaskDispatch(servicePool,unknownJob,async()=>({code:1,timedOut:true,diagnostics:'injected timeout',output:''}));
        assert.equal((await c.query('SELECT state FROM gameai.executions WHERE id=$1',[unknownJob.executionId])).rows[0].state,'unknown');
        const saved=(await c.query('SELECT response FROM gameai.task_publications WHERE execution_id=$1',[unknownJob.executionId])).rows[0].response;
        await c.query(`INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state,finished_at)
            VALUES($1,$2,$3,'failed',now())`,[unknownJob.executionId.replaceAll('-',''),conversation,createHash('sha256').update(unknownJob.prompt).digest('hex')]);
        await finishReceivedTask(servicePool,unknownJob,saved);
        assert.equal((await c.query('SELECT state FROM gameai.executions WHERE id=$1',[unknownJob.executionId])).rows[0].state,'failed');
        assert.equal((await c.query('SELECT state FROM gameai.task_repairs WHERE execution_id=$1',[unknownJob.executionId])).rows[0].state,'pending','late actual stop proof returns the original execution to durable recovery');

        await c.query('ROLLBACK TO SAVEPOINT recovery_cases');
        failAlways=false;
        calls=0;
        const unconfirmedSuccess=await dispatchTasks(servicePool,key,user,request,true,true);
        const successfulJob=unconfirmedSuccess.jobs[0];
        await runTaskDispatch(servicePool,successfulJob,async args=>
        {
            const result=await execute(args);
            const envelope=JSON.parse(result.output);
            const content=JSON.parse(envelope.Text);
            content.verdict='pass';
            content.summary='故障注入：成功结果先到，停止凭据后到';
            content.checks.forEach(check=>{check.passed=true;});
            envelope.Text=JSON.stringify(content);
            result.output=JSON.stringify(envelope);
            await writeFile(path,'FIXED');
            await c.query("UPDATE gameai.agent_runs SET state='unknown' WHERE execution_id=$1",[successfulJob.executionId.replaceAll('-','')]);
            return result;
        });
        assert.equal((await c.query('SELECT state FROM gameai.executions WHERE id=$1',[successfulJob.executionId])).rows[0].state,'unknown');
        await c.query("UPDATE gameai.agent_runs SET state='completed',finished_at=clock_timestamp() WHERE execution_id=$1",[successfulJob.executionId.replaceAll('-','')]);
        const successfulResponse=(await c.query('SELECT response FROM gameai.task_publications WHERE execution_id=$1',[successfulJob.executionId])).rows[0].response;
        await finishReceivedTask(servicePool,successfulJob,successfulResponse);
        assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[task.id])).rows[0].status,'completed','late valid success resumes the original authorized flow without repeating production');
        assert.equal((await c.query('SELECT state FROM gameai.task_repairs WHERE execution_id=$1',[successfulJob.executionId])).rows[0].state,'resolved');
    }
    finally
    {
        await c.query('ROLLBACK TO SAVEPOINT recovery_loop');
        await unlink(path).catch(()=>{});
    }
}
