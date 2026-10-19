import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot} from '../src/paths.js';
import {dispatchTasks} from '../src/database/task-dispatch.js';
import {runTaskDispatch} from '../src/track/task-dispatch.js';
import {continueTaskFlow} from '../src/track/task-flow.js';
import {readCollaboration} from '../src/database/collaboration.js';

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
                assert.match(input.failure_context.instruction,/先分析上次失败/);
                assert.ok(input.failure_context.collaboration_feedback.some(m=>m.event==='任务失败，安排原 Agent 修复重试'));
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
        assert.ok(history.messages.some(m=>m.event==='任务失败，安排原 Agent 修复重试'));
        assert.ok(history.messages.some(m=>m.body.includes('文件内容错误') && m.body.includes('文件内容检查')));
        await continueTaskFlow(servicePool,task.plan_version_id,execute);
        assert.equal(calls,2);
        assert.equal(await readFile(path,'utf8'),'FIXED');
        assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[task.id])).rows[0].status,'completed');
        assert.deepEqual((await c.query('SELECT state FROM gameai.executions WHERE task_id=$1 ORDER BY started_at',[task.id])).rows.map(r=>r.state),['failed','succeeded']);
        history=await readCollaboration(servicePool,key);
        for (const event of ['任务失败，安排原 Agent 修复重试','编排器自动派发专业任务','工程交付校验通过，通知后续任务'])
        {
            assert.ok(history.messages.some(m=>m.event===event),'Missing collaboration event: '+event);
        }
        await c.query('ROLLBACK TO SAVEPOINT recovery_cases');
        calls=0;
        failAlways=true;
        await continueTaskFlow(servicePool,task.plan_version_id,execute);
        assert.equal(calls,3);
        assert.equal((await c.query('SELECT state FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[task.plan_version_id])).rows[0].state,'paused');
        const last=(await c.query('SELECT result FROM gameai.executions WHERE task_id=$1 ORDER BY started_at DESC LIMIT 1',[task.id])).rows[0];
        assert.equal(last.result.recovery.code,'retry_exhausted');
        history=await readCollaboration(servicePool,key);
        assert.ok(history.messages.some(m=>m.event==='任务自动修复停止，等待人工处理'));
    }
    finally
    {
        await c.query('ROLLBACK TO SAVEPOINT recovery_loop');
        await unlink(path).catch(()=>{});
    }
}
