import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {dispatchTasks} from '../src/database/task-dispatch.js';
import {agentRunRequest} from '../src/database/agent-runs.js';
import {runTaskChain} from '../src/track/task-flow.js';
import {runTaskDispatch} from '../src/track/task-dispatch.js';
import {setTaskDispatchSelection} from '../src/database/task-dispatch-selection.js';
import {validateTaskResult} from '../src/database/task-results.js';
import {validateQaReport} from '../src/database/qa-repairs.js';

export async function qaScenarios({c,p,w,user,projectKey,servicePool,rows,child,devAgent,claim})
{
    const qa=rows.find(t=>t.role_code==='QA');
    const qaAgent=(await c.query("INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity) VALUES($1,'qa-01','QA',$2,true,'测试 QA',1) RETURNING id",[p,w])).rows[0].id;
    await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'QA',$2)",[p,qaAgent]);
    await c.query("INSERT INTO gameai.agent_grants(project_id,agent_id,permission_code) VALUES($1,$2,'task.write_assigned')",[p,qaAgent]);
    await c.query("INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,is_primary,content_hash) SELECT $1,$2,skill_key,true,content_hash FROM gameai.skills WHERE skill_key='gameai-qa'",[p,qaAgent]);
    assert.equal((await dispatchTasks(servicePool,projectKey,user,{tasks:[{task_id:qa.id,revision:0}]})).rows[0].ready,false,'QA still requires human dispatch selection');
    await setTaskDispatchSelection(servicePool,projectKey,user,{task_id:qa.id,revision:0,allowed:true});
    const request={tasks:[{task_id:qa.id,revision:1}],auto_continue:true};
    const evidence='docs/gamecli-server-architecture.md';
    const report={verdict:'pass',summary:'隔离协议测试',deliverables:['测试报告'],files:[evidence],questions:[],checks:[{name:'行为验收',passed:true,evidence_path:evidence}],defects:[],retests:[]};
    const defect={case_key:'CLAIM-01',source_task_key:child.task_key,title:'重复领取',preconditions:'奖励可领取',steps:'连续点击领取',expected:'仅发一次',actual:'实际发放两次',evidence_path:evidence,fix_acceptance:'重复请求只发放一次'};
    assert.throws(()=>validateTaskResult({...report,verdict:'blocked',questions:['缺少游戏工程']},'QA'),/执行阻塞/);
    assert.throws(()=>validateTaskResult({...report,verdict:'fail'},'QA'),/缺陷必须/);
    assert.throws(()=>validateQaReport({dependencies:[],retests:[]},{...report,verdict:'fail',defects:[defect]}),/原开发/);
    const runRoles=[];
    let qaCalls=0;
    const execute=(failureCount)=>async(args,command)=>
    {
        const id=args[args.indexOf('--execution-id')+1].replaceAll('-','');
        const prompt=await readFile(args[args.indexOf('--prompt-file')+1],'utf8');
        const data=JSON.parse(prompt);
        const hash=createHash('sha256').update(prompt).digest('hex');
        const role=command[0]==='qa'?'QA':'Development';
        const thread=role==='QA'?'test-qa-thread':'test-dev-thread';
        const lease=await agentRunRequest(servicePool,projectKey,{...claim,execution_id:id,role,input_hash:hash});
        assert.equal(lease.agent_key,role==='QA'?'qa-01':'dev-01');
        if (role==='Development') {assert.equal(lease.thread_id,'test-dev-thread');assert.equal(data.repair.developer_agent_id,devAgent);}
        if (role==='QA' && qaCalls) assert.equal(lease.thread_id,'test-qa-thread');
        await agentRunRequest(servicePool,projectKey,{action:'attach',execution_id:id,worker_key:claim.worker_key,thread_id:thread});
        await agentRunRequest(servicePool,projectKey,{action:'finish',execution_id:id,worker_key:claim.worker_key,state:'completed'});
        runRoles.push(role);
        const fail=role==='QA' && ++qaCalls<=failureCount;
        const content={...report,verdict:fail?'fail':'pass',checks:[{...report.checks[0],passed:!fail}],defects:fail?[defect]:[],retests:role==='QA'?data.retests.map(d=>({defect_id:d.id,passed:!fail,evidence_path:evidence})):[]};
        return {code:0,diagnostics:'isolated QA execution',output:JSON.stringify({ThreadId:thread,InputSha256:hash,Text:JSON.stringify(content)})};
    };
    await c.query('SAVEPOINT qa_scenarios');
    let started=await dispatchTasks(servicePool,projectKey,user,request,true);
    await runTaskChain(servicePool,started.jobs[0],execute(2));
    assert.deepEqual(runRoles,['QA','Development','QA','Development','QA']);
    let defects=(await c.query('SELECT * FROM gameai.qa_defects WHERE project_id=$1',[p])).rows;
    assert.equal(defects.length,1,'Repeated failure reuses the defect and repair task');
    assert.equal(defects[0].rounds,2);
    assert.equal(defects[0].state,'closed');
    assert.equal(defects[0].developer_agent_id,devAgent);
    assert.equal(defects[0].qa_agent_id,qaAgent);
    const repair=(await c.query('SELECT * FROM gameai.tasks WHERE id=$1',[defects[0].repair_task_id])).rows[0];
    assert.equal(repair.parent_id,child.parent_id);
    assert.equal(repair.bound_agent_id,devAgent);
    assert.equal(repair.status,'completed');
    assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[qa.id])).rows[0].status,'review');
    await c.query('ROLLBACK TO SAVEPOINT qa_scenarios');
    qaCalls=0;runRoles.length=0;
    started=await dispatchTasks(servicePool,projectKey,user,request,true);
    await runTaskChain(servicePool,started.jobs[0],execute(Infinity));
    defects=(await c.query('SELECT * FROM gameai.qa_defects WHERE project_id=$1',[p])).rows;
    assert.equal(defects.length,1);
    assert.equal(defects[0].rounds,3);
    assert.equal(defects[0].state,'exhausted');
    assert.equal(runRoles.length,7);
    assert.equal((await c.query('SELECT state FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[qa.plan_version_id])).rows[0].state,'paused');
    await c.query('ROLLBACK TO SAVEPOINT qa_scenarios');
    qaCalls=0;
    started=await dispatchTasks(servicePool,projectKey,user,request,true);
    await runTaskDispatch(servicePool,started.jobs[0],execute(1));
    const open=(await c.query('SELECT * FROM gameai.qa_defects WHERE project_id=$1',[p])).rows[0];
    const repairRequest={tasks:[{task_id:open.repair_task_id,revision:1}]};
    await c.query('UPDATE gameai.fixed_agents SET agent_id=$2 WHERE project_id=$1 AND role_code=$3',[p,qaAgent,'Development']);
    assert.match((await dispatchTasks(servicePool,projectKey,user,repairRequest)).rows[0].reason,/原执行 Agent/);
    await c.query('UPDATE gameai.fixed_agents SET agent_id=$2 WHERE project_id=$1 AND role_code=$3',[p,devAgent,'Development']);
    assert.match((await dispatchTasks(servicePool,projectKey,user,request)).rows[0].reason,/等待返修/);
    await c.query('ROLLBACK TO SAVEPOINT qa_scenarios');
    qaCalls=0;
    started=await dispatchTasks(servicePool,projectKey,user,request,true);
    await runTaskDispatch(servicePool,started.jobs[0],async(...args)=>
    {
        const run=await execute(0)(...args);
        const result=JSON.parse(run.output);
        result.Text=JSON.stringify({...report,verdict:'blocked',questions:['测试入口缺失']});
        return {...run,output:JSON.stringify(result)};
    });
    assert.equal((await c.query('SELECT count(*)::int n FROM gameai.qa_defects WHERE project_id=$1',[p])).rows[0].n,0);
    assert.equal((await c.query('SELECT state FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[qa.plan_version_id])).rows[0].state,'paused');
    await c.query('ROLLBACK TO SAVEPOINT qa_scenarios');
    const root=new URL('../../../../../../../',import.meta.url);
    const relative='Artifacts/qa-protocol-'+randomUUID()+'.txt';
    const file=new URL(relative,root);
    await mkdir(new URL('Artifacts/',root),{recursive:true});
    try
    {
        await writeFile(file,'before');
        const oldHash=createHash('sha256').update('before').digest('hex');
        const newHash=createHash('sha256').update('after').digest('hex');
        await c.query(`UPDATE gameai.executions SET result=jsonb_set(result,'{artifacts}',$2::jsonb) WHERE task_id=$1 AND state='succeeded'`,[child.id,JSON.stringify([{path:relative,sha256:oldHash}])]);
        qaCalls=0;runRoles.length=0;
        started=await dispatchTasks(servicePool,projectKey,user,request,true);
        assert.equal(started.jobs.length,1,JSON.stringify(started.rows));
        await runTaskChain(servicePool,started.jobs[0],async(args,command)=>
        {
            const run=await execute(1)(args,command);
            const data=JSON.parse(await readFile(args[args.indexOf('--prompt-file')+1],'utf8'));
            if (command[0]==='development')
            {
                await writeFile(file,'after');
                const result=JSON.parse(run.output);
                const content=JSON.parse(result.Text);
                content.files.push(relative);
                result.Text=JSON.stringify(content);
                return {...run,output:JSON.stringify(result)};
            }
            assert.equal(data.dependencies.find(d=>d.id===child.id).artifacts.find(f=>f.path===relative).sha256,qaCalls===1?oldHash:newHash);
            return run;
        });
        assert.deepEqual(runRoles,['QA','Development','QA']);
        assert.equal((await c.query('SELECT state FROM gameai.qa_defects WHERE project_id=$1',[p])).rows[0].state,'closed');
        assert.equal((await c.query(`SELECT result->'artifacts' artifacts FROM gameai.executions WHERE task_id=$1 AND state='succeeded'`,[child.id])).rows[0].artifacts[0].sha256,oldHash,'Original delivery manifest stays immutable');
    }
    finally {await unlink(file);await c.query('ROLLBACK TO SAVEPOINT qa_scenarios');}
}
