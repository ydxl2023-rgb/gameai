import {qaScenarios} from './qa-scenarios.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createPool } from '../src/database/connection.js';
import { submitRequirement,reviewRequirement } from '../src/database/requirements.js';
import { startPmJob,publishPmPlan,failPmJob,validatePmPlan } from '../src/database/pm-plans.js';
import { dispatchPmJob } from '../src/track/pm-dispatch.js';
import { dispatchTasks } from '../src/database/task-dispatch.js';
import { agentRunRequest } from '../src/database/agent-runs.js';
import { runTaskChain } from '../src/track/task-flow.js';
import { runTaskDispatch } from '../src/track/task-dispatch.js';
import { setTaskDispatchSelection } from '../src/database/task-dispatch-selection.js';

const acceptance = {preconditions:'已批准版本',steps:'制作并提交占位资源',success:'资源可供程序引用',failure:'缺失资源提示原因',recovery:'修正资源后重试验收',tests:'待执行：核对导入与规格'};
const art = {id:'ART-1',title:'登录活动占位布局',role:'Art',description:'交付可供程序使用的占位布局和图标，不制作正式美术。',source_refs:['4.1 占位资源'],acceptance,depends_on:[]};
const dev = {...art,id:'DEV-1',title:'登录活动界面交互',role:'Development',source_refs:['3.3 打开活动'],depends_on:['ART-1']};
const plan = {summary:'按批准交付标准拆分',tasks:[dev,art]};

test('PM proposal validation rejects invalid roles, missing criteria and cyclic graphs',() =>
{
    assert.deepEqual(validatePmPlan(plan).tasks.map(t => t.id),['ART-1','DEV-1']);
    assert.throws(() => validatePmPlan({...plan,tasks:[art,art]}),/编号重复/);
    assert.throws(() => validatePmPlan({...plan,tasks:[{...art,role:'Unknown'}]}),/角色/);
    assert.throws(() => validatePmPlan({...plan,tasks:[{...art,acceptance:{}}]}),/交付标准/);
    assert.throws(() => validatePmPlan({...plan,tasks:[dev]}),/不存在/);
    assert.throws(() => validatePmPlan({...plan,tasks:[dev,{...art,depends_on:['DEV-1']}]}),/循环/);
});

test('manual PM gate, idempotency, fixed-run proof, atomic publication and retry limits (rollback)',async () =>
{
    const pool = createPool();
    const c = await pool.connect();
    await c.query('BEGIN');
    let failSecondTask = false;
    const servicePool = {query:(sql,params) => c.query(sql,params),connect:async () => ({
        query:async (sql,params) =>
        {
            if (failSecondTask && sql.startsWith('INSERT INTO gameai.tasks') && params.includes('Development'))
            {
                throw new Error('Injected publication failure');
            }
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
        const projectKey = 'PM-TEST-'+randomUUID();
        const p = (await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[projectKey])).rows[0].id;
        const user = (await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        const outsider = (await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        await c.query("INSERT INTO gameai.user_roles VALUES($1,$2,'Design')",[p,user]);
        const w = (await c.query('INSERT INTO gameai.workers(project_id,worker_key,name,capacity,enabled) VALUES($1,$2,$2,1,true) RETURNING id',[p,hostname().toLowerCase()])).rows[0].id;
        const a = (await c.query("INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity) VALUES($1,'pm-01','PM',$2,true,'测试 PM',1) RETURNING id",[p,w])).rows[0].id;
        await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'PM',$2)",[p,a]);
        const writer = parseEnv(await readFile(new URL('../.env.workflow',import.meta.url),'utf8'));
        for (const table of ['pm_jobs','plans','plan_versions','tasks','task_dependencies'])
        {
            assert.equal((await c.query('SELECT has_table_privilege($1,$2,$3) allowed',[writer.PGUSER,'gameai.'+table,'INSERT'])).rows[0].allowed,true);
        }
        assert.equal((await c.query("SELECT has_table_privilege($1,'gameai.pm_jobs','UPDATE') allowed",[writer.PGUSER])).rows[0].allowed,true);
        const html = '<!doctype html><html lang="zh-CN"><head><title>隔离测试</title></head><body><h1>登录活动</h1><p>3.3 打开活动；4.1 占位资源。</p></body></html>';
        const input = {request_id:randomUUID(),requirement_key:'TEST-PM',title:'隔离测试需求',version:'v1',html,sha256:createHash('sha256').update(html).digest('hex'),execution_id:'test-design',thread_id:'test-design-thread',summary:'测试'};
        const version = await submitRequirement(servicePool,projectKey,input);
        const request = {version_id:version.version_id,revision:version.revision,document_hash:version.document_hash};
        await assert.rejects(startPmJob(servicePool,projectKey,user,request),/已人工批准/);
        await reviewRequirement(servicePool,projectKey,user,{...request,decision:'approved',reason:''});
        await assert.rejects(startPmJob(servicePool,projectKey,outsider,request),/权限/);
        await assert.rejects(startPmJob(servicePool,projectKey,user,{...request,document_hash:'0'.repeat(64)}),/校验/);
        let started = await startPmJob(servicePool,projectKey,user,request);
        assert.equal(started.created,true);
        assert.equal((await startPmJob(servicePool,projectKey,user,request)).created,false);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.tasks WHERE project_id=$1',[p])).rows[0].n,0);
        await assert.rejects(publishPmPlan(servicePool,projectKey,started.job,{execution_id:started.job.execution_id,thread_id:'fake',plan}),/固定 PM/);
        await failPmJob(servicePool,started.job,'测试失败');
        started = await startPmJob(servicePool,projectKey,user,request);
        assert.equal(started.job.attempts,2);
        const session = (await c.query("INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id,thread_id) VALUES($1,'TEST-PM','PM',$2,$3,'test-pm-thread') RETURNING id",[p,a,w])).rows[0].id;
        await c.query("INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state) VALUES($1,$2,$3,'completed')",[started.job.execution_id,session,'a'.repeat(64)]);
        const result = {execution_id:started.job.execution_id,thread_id:'test-pm-thread',plan};
        await assert.rejects(publishPmPlan(servicePool,projectKey,started.job,{...result,plan:{...plan,tasks:[dev]}}),/不存在/);
        await c.query('SAVEPOINT automatic_approval');
        await c.query("INSERT INTO gameai.approval_workflows(version_id,project_id,requested_by,revision,document_hash,state) VALUES($1,$2,$3,$4,$5,'pm')",[version.version_id,p,user,version.revision,version.document_hash]);
        await publishPmPlan(servicePool,projectKey,started.job,result);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.tasks WHERE project_id=$1 AND parent_id IS NOT NULL AND dispatch_allowed',[p])).rows[0].n,3);
        assert.equal((await c.query('SELECT state FROM gameai.approval_workflows WHERE version_id=$1',[version.version_id])).rows[0].state,'dispatched');
        assert.equal((await c.query('SELECT state FROM gameai.plan_dispatch_flows WHERE project_id=$1',[p])).rows[0].state,'active');
        await c.query('ROLLBACK TO SAVEPOINT automatic_approval');
        failSecondTask = true;
        await assert.rejects(publishPmPlan(servicePool,projectKey,started.job,result),/Injected/);
        failSecondTask = false;
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.tasks WHERE project_id=$1',[p])).rows[0].n,0);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.plans WHERE project_id=$1',[p])).rows[0].n,0);
        // Exercise the actual dispatch/publication function with deterministic CLI output, not a paid model invocation.
        await dispatchPmJob(servicePool,projectKey,started,async args =>
        {
            assert.ok(args.includes(started.job.execution_id));
            return {code:0,output:JSON.stringify(result),diagnostics:'mock PM protocol output',timedOut:false,overflow:false};
        });
        const rows = (await c.query('SELECT * FROM gameai.tasks WHERE project_id=$1 ORDER BY task_key',[p])).rows;
        assert.equal(rows.length,4);
        for (const task of rows)
        {
            const prefix = {PM:'T',Art:'A',Development:'P',QA:'Q'}[task.role_code];
            assert.match(task.task_key,new RegExp('^'+prefix+'-[0-9]{7}$'));
        }
        assert.equal(new Set(rows.map(t => t.task_key)).size,4);
        assert.equal(rows.filter(t => t.parent_id).length,3);
        assert.equal(rows.find(t => t.role_code === 'Development').status,'blocked');
        assert.equal(rows.find(t => t.role_code === 'Art').delivery_criteria.length,6);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.task_dependencies WHERE project_id=$1',[p])).rows[0].n,2);
        assert.equal((await publishPmPlan(servicePool,projectKey,started.job,result)).state,'completed');
        assert.equal((await startPmJob(servicePool,projectKey,user,request)).job.task_count,3);
        await failPmJob(servicePool,started.job,'late failure');
        assert.equal((await startPmJob(servicePool,projectKey,user,request)).job.state,'completed');
        const child = rows.find(t => t.role_code === 'Development');
        const parentTask = rows.find(t => !t.parent_id);
        const selection = {task_id:child.id,allowed:true,revision:0};
        await assert.rejects(setTaskDispatchSelection(servicePool,projectKey,outsider,selection),/人工账户/);
        await assert.rejects(setTaskDispatchSelection(servicePool,projectKey,user,{...selection,task_id:parentTask.id}),/子任务/);
        assert.equal((await setTaskDispatchSelection(servicePool,projectKey,user,selection)).dispatch_allowed,true);
        assert.equal((await setTaskDispatchSelection(servicePool,projectKey,user,selection)).dispatch_revision,1);
        await assert.rejects(setTaskDispatchSelection(servicePool,projectKey,user,{...selection,allowed:false}),/已被修改/);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.executions WHERE project_id=$1',[p])).rows[0].n,0);
        assert.equal((await c.query('SELECT dispatch_allowed FROM gameai.tasks WHERE id=$1',[rows.find(t => t.role_code === 'Art').id])).rows[0].dispatch_allowed,false);
        assert.equal((await setTaskDispatchSelection(servicePool,projectKey,user,{...selection,allowed:false,revision:1})).dispatch_allowed,false);
        await c.query("UPDATE gameai.tasks SET status='running' WHERE id=$1",[child.id]);
        await assert.rejects(setTaskDispatchSelection(servicePool,projectKey,user,{...selection,revision:2}),/已派发/);
        await c.query("UPDATE gameai.tasks SET status='blocked' WHERE id=$1",[child.id]);
        const artTask=rows.find(t=>t.role_code==='Art');
        const artAgent=(await c.query("INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity) VALUES($1,'art-01','Art',$2,true,'测试 Art',1) RETURNING id",[p,w])).rows[0].id;
        await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'Art',$2)",[p,artAgent]);
        await c.query("INSERT INTO gameai.agent_grants(project_id,agent_id,permission_code) VALUES($2,$1,'task.write_assigned')",[artAgent,p]);
        await c.query("INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,is_primary,content_hash) SELECT $2,$1,skill_key,true,content_hash FROM gameai.skills WHERE skill_key='gameai-art'",[artAgent,p]);
        await setTaskDispatchSelection(servicePool,projectKey,user,{task_id:artTask.id,revision:0,allowed:true});
        const dispatchInput={tasks:[{task_id:artTask.id,revision:1}]};
        await assert.rejects(dispatchTasks(servicePool,projectKey,outsider,dispatchInput),/人工账户/);
        const preview=await dispatchTasks(servicePool,projectKey,user,dispatchInput);
        assert.equal(preview.rows[0].ready,true);
        assert.equal(preview.jobs.length,0);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.executions WHERE project_id=$1',[p])).rows[0].n,0);
        await setTaskDispatchSelection(servicePool,projectKey,user,{task_id:child.id,revision:2,allowed:true});
        assert.match((await dispatchTasks(servicePool,projectKey,user,{tasks:[{task_id:child.id,revision:3}]})).rows[0].reason,/依赖未完成/);
        const dispatched=await dispatchTasks(servicePool,projectKey,user,dispatchInput,true);
        assert.equal(dispatched.jobs.length,1);
        assert.equal((await dispatchTasks(servicePool,projectKey,user,dispatchInput,true)).jobs.length,0);
        const job=dispatched.jobs[0];
        const runId=job.executionId.replaceAll('-','');
        const claim={action:'claim',execution_id:runId,role:'Art',requirement_key:'TEST-PM',worker_key:hostname().toLowerCase(),input_hash:createHash('sha256').update(job.prompt).digest('hex')};
        await assert.rejects(agentRunRequest(servicePool,projectKey,{...claim,input_hash:'0'.repeat(64)}),/授权无效/);
        const claimed=await agentRunRequest(servicePool,projectKey,claim);
        assert.equal(claimed.workspace_write,true);
        await agentRunRequest(servicePool,projectKey,{action:'attach',execution_id:runId,worker_key:claim.worker_key,thread_id:'test-art-thread'});
        await agentRunRequest(servicePool,projectKey,{action:'finish',execution_id:runId,worker_key:claim.worker_key,state:'completed'});
        await runTaskDispatch(servicePool,job,async(args,command)=>
        {
            assert.deepEqual(command,['art','execute']);
            assert.ok(args.includes(job.executionId));
            return {code:0,diagnostics:'deterministic test',output:JSON.stringify({ThreadId:'test-art-thread',InputSha256:createHash('sha256').update(job.prompt).digest('hex'),Text:JSON.stringify({verdict:'pass',checks:[{name:'测试文件可读取',passed:true,evidence_path:'docs/gamecli-server-architecture.md'}],summary:'测试交付',deliverables:['测试报告'],questions:[],files:['docs/gamecli-server-architecture.md']})})};
        });
        assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[artTask.id])).rows[0].status,'review');
        assert.equal((await c.query('SELECT state FROM gameai.executions WHERE id=$1',[job.executionId])).rows[0].state,'succeeded');
        assert.match((await dispatchTasks(servicePool,projectKey,user,{tasks:[{task_id:child.id,revision:3}]})).rows[0].reason,/依赖未完成/,'Submitted output is not accepted output');
        await c.query('SAVEPOINT automatic_scenario');
        const devAgent=(await c.query("INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity) VALUES($1,'dev-01','Development',$2,true,'测试开发',1) RETURNING id",[p,w])).rows[0].id;
        await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'Development',$2)",[p,devAgent]);
        await c.query("INSERT INTO gameai.agent_grants(project_id,agent_id,permission_code) VALUES($1,$2,'task.write_assigned')",[p,devAgent]);
        await c.query("INSERT INTO gameai.agent_skills(project_id,agent_id,skill_key,is_primary,content_hash) SELECT $1,$2,skill_key,true,content_hash FROM gameai.skills WHERE skill_key='gameai-dev'",[p,devAgent]);
        await c.query("UPDATE gameai.tasks SET status='failed' WHERE id=$1",[artTask.id]);
        const extra=(await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,parent_id,title,role_code) VALUES($1,$2,$3,'未勾选任务','Art') RETURNING id",[p,artTask.plan_version_id,parentTask.id])).rows[0];
        const automatic=await dispatchTasks(servicePool,projectKey,user,{...dispatchInput,auto_continue:true,retry:true},true);
        const rolesRun=[];
        await runTaskChain(servicePool,automatic.jobs[0],async(args,command)=>
        {
            const id=args[args.indexOf('--execution-id')+1].replaceAll('-','');
            const prompt=await readFile(args[args.indexOf('--prompt-file')+1],'utf8');
            const hash=createHash('sha256').update(prompt).digest('hex');
            const role=command[0]==='art'?'Art':'Development';
            rolesRun.push(role);
            assert.equal(JSON.parse(prompt).platform_context.authoritative,true);
            await agentRunRequest(servicePool,projectKey,{...claim,execution_id:id,role,input_hash:hash});
            const thread=role==='Art'?'test-art-thread':'test-dev-thread';
            await agentRunRequest(servicePool,projectKey,{action:'attach',execution_id:id,worker_key:claim.worker_key,thread_id:thread});
            await agentRunRequest(servicePool,projectKey,{action:'finish',execution_id:id,worker_key:claim.worker_key,state:'completed'});
            return {code:0,diagnostics:'test chain',output:JSON.stringify({ThreadId:thread,InputSha256:hash,Text:JSON.stringify({verdict:'pass',summary:'真实测试替身',deliverables:['报告'],files:['docs/gamecli-server-architecture.md'],checks:[{name:'证据可读取',passed:true,evidence_path:'docs/gamecli-server-architecture.md'}],questions:[]})})};
        });
        assert.deepEqual(rolesRun,['Art','Development']);
        assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[child.id])).rows[0].status,'completed');
        assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[extra.id])).rows[0].status,'pending');
        assert.equal((await c.query('SELECT state FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[artTask.plan_version_id])).rows[0].state,'completed');
        await qaScenarios({c,p,w,user,projectKey,servicePool,rows,child,devAgent,claim});
        await c.query('ROLLBACK TO SAVEPOINT automatic_scenario');
        await c.query("UPDATE gameai.tasks SET status='failed' WHERE id=$1",[artTask.id]);
        const failedChain=await dispatchTasks(servicePool,projectKey,user,{...dispatchInput,auto_continue:true,retry:true},true);
        let failedCalls=0;
        await runTaskChain(servicePool,failedChain.jobs[0],async(args)=>
        {
            failedCalls++;
            const id=args[args.indexOf('--execution-id')+1].replaceAll('-','');
            const prompt=await readFile(args[args.indexOf('--prompt-file')+1],'utf8');
            await agentRunRequest(servicePool,projectKey,{...claim,execution_id:id,input_hash:createHash('sha256').update(prompt).digest('hex')});
            await agentRunRequest(servicePool,projectKey,{action:'finish',execution_id:id,worker_key:claim.worker_key,state:'failed'});
            return {code:3,diagnostics:'isolated failure',output:''};
        });
        assert.equal(failedCalls,1);
        assert.equal((await c.query('SELECT state FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[artTask.plan_version_id])).rows[0].state,'paused');
        assert.equal((await c.query('SELECT status FROM gameai.tasks WHERE id=$1',[child.id])).rows[0].status,'blocked');
        await c.query('ROLLBACK TO SAVEPOINT automatic_scenario');
        const next = await submitRequirement(servicePool,projectKey,{...input,request_id:randomUUID(),version:'v2'});
        await assert.rejects(setTaskDispatchSelection(servicePool,projectKey,user,{...selection,revision:2}),/最新已批准/);
        await assert.rejects(startPmJob(servicePool,projectKey,user,request),/最新/);
        const nextRequest = {version_id:next.version_id,revision:next.revision,document_hash:next.document_hash};
        await reviewRequirement(servicePool,projectKey,user,{...nextRequest,decision:'approved',reason:''});
        for (let i=0;i<3;i++)
        {
            const retry = await startPmJob(servicePool,projectKey,user,nextRequest);
            await failPmJob(servicePool,retry.job,'isolated failure');
        }
        await assert.rejects(startPmJob(servicePool,projectKey,user,nextRequest),/3 次/);
        const third = await submitRequirement(servicePool,projectKey,{...input,request_id:randomUUID(),version:'v3'});
        const thirdRequest = {version_id:third.version_id,revision:third.revision,document_hash:third.document_hash};
        await reviewRequirement(servicePool,projectKey,user,{...thirdRequest,decision:'approved',reason:''});
        const uncertain = await startPmJob(servicePool,projectKey,user,thirdRequest);
        await c.query("INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state) VALUES($1,$2,$3,'running')",[uncertain.job.execution_id,session,'b'.repeat(64)]);
        await failPmJob(servicePool,uncertain.job,'transport timeout');
        const repeated = await startPmJob(servicePool,projectKey,user,thirdRequest);
        assert.equal(repeated.created,false);
        assert.equal(repeated.job.state,'unknown');
        for (const [role,prefix] of [['Design','D'],['QA','Q']])
        {
            const task = (await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code) VALUES($1,$2,'编号隔离测试',$3) RETURNING task_key",[p,rows[0].plan_version_id,role])).rows[0];
            assert.match(task.task_key,new RegExp('^'+prefix+'-[0-9]{7}$'));
        }
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
