import {readRequirementRules} from '../src/database/requirement-rules.js';
import {reviewedHtml} from './ui-production-fixture.js';
import {recoveryLoopScenario} from './recovery-loop-scenario.js';
import {buildProductionSkeleton} from '../src/database/design-contract.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {createPool} from '../src/database/connection.js';
import {submitRequirement,reviewRequirement} from '../src/database/requirements.js';
import {startPmJob,publishPmPlan,failPmJob,validatePmPlan} from '../src/database/pm-plans.js';
import {buildUiDeliverySkeleton} from '../src/database/ui-delivery-plan.js';
import {manifestFixture,htmlFixture,planFixture} from './ui-delivery-fixture.js';
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

test('UI publication binds approved manifest, is atomic, preserves consent and persists logical identity',async () =>
{
    const pool = createPool();
    const c = await pool.connect();
    await c.query('BEGIN');
    let injectFailure = false;
    const servicePool = {query:(sql,params) => c.query(sql,params),connect:async () => ({query:async (sql,params) =>
    {
        if (sql === 'BEGIN') return c.query('SAVEPOINT service_operation');
        if (sql === 'COMMIT') return c.query('RELEASE SAVEPOINT service_operation');
        if (sql === 'ROLLBACK') return c.query('ROLLBACK TO SAVEPOINT service_operation');
        if (injectFailure && sql.includes('INSERT INTO gameai.tasks') && params[4]==='Art') throw new Error('Injected failure');
        return c.query(sql,params);
    },release:() => {}})};
    try
    {
        const key = 'UI-PLAN-TEST-'+randomUUID();
        const p = (await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[key])).rows[0].id;
        const user = (await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        const outsider = (await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        await c.query("INSERT INTO gameai.user_roles VALUES($1,$2,'Design')",[p,user]);
        const worker = (await c.query('INSERT INTO gameai.workers(project_id,worker_key,name,capacity,enabled) VALUES($1,$2,$2,1,true) RETURNING id',[p,hostname().toLowerCase()])).rows[0].id;
        const agent = (await c.query("INSERT INTO gameai.agents(project_id,agent_key,role_code,worker_id,enabled,display_name,capacity) VALUES($1,'pm-01','PM',$2,true,'测试 PM',1) RETURNING id",[p,worker])).rows[0].id;
        await c.query("INSERT INTO gameai.fixed_agents VALUES($1,'PM',$2)",[p,agent]);
        async function submit(version,html = reviewedHtml(p,'test-design','test-design-thread'))
        {
            const input = {request_id:randomUUID(),requirement_key:'TEST-UI',title:'隔离测试',version,html,sha256:createHash('sha256').update(html).digest('hex'),execution_id:'test-design',thread_id:'test-design-thread',summary:'测试'};
            const saved = await submitRequirement(servicePool,key,input);
            const rules=await readRequirementRules(c,saved.version_id,'PM');
            assert.ok(rules.instructions.length>100);
            await c.query('SAVEPOINT snapshot_immutable');
            await assert.rejects(c.query("UPDATE gameai.requirement_rule_snapshots SET sha256='changed' WHERE version_id=$1",[saved.version_id]));
            await c.query('ROLLBACK TO SAVEPOINT snapshot_immutable');
            return {version_id:saved.version_id,revision:saved.revision,document_hash:saved.document_hash};
        }
        const request = await submit('v1');
        await assert.rejects(startPmJob(servicePool,key,user,request),/批准/);
        await reviewRequirement(servicePool,key,user,{...request,decision:'approved',reason:''});
        await assert.rejects(startPmJob(servicePool,key,outsider,request),/权限/);
        const started = await startPmJob(servicePool,key,user,request);
        assert.equal((await startPmJob(servicePool,key,user,request)).created,false);
        const plan = planFixture(buildProductionSkeleton(reviewedHtml(p),'v1'));
        const result = {execution_id:started.job.execution_id,thread_id:'test-pm',plan};
        await assert.rejects(publishPmPlan(servicePool,key,started.job,result),/固定 PM/);
        const conversation = (await c.query("INSERT INTO gameai.agent_conversations(project_id,requirement_key,role_code,agent_id,worker_id,thread_id) VALUES($1,'TEST-UI','PM',$2,$3,'test-pm') RETURNING id",[p,agent,worker])).rows[0].id;
        await c.query("INSERT INTO gameai.agent_runs(execution_id,conversation_id,request_hash,state) VALUES($1,$2,$3,'completed')",[started.job.execution_id,conversation,'a'.repeat(64)]);
        for (const mutate of [tasks => tasks.pop(),tasks => tasks[0].role = 'Art',tasks => tasks[0].source_refs = ['#other'],tasks => tasks[1].depends_on = []])
        {
            const invalid = structuredClone(result);
            mutate(invalid.plan.tasks);
            await assert.rejects(publishPmPlan(servicePool,key,started.job,invalid),/UI 交付清单/);
        }
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.tasks WHERE project_id=$1',[p])).rows[0].n,0);
        injectFailure = true;
        await assert.rejects(publishPmPlan(servicePool,key,started.job,result),/Injected/);
        injectFailure = false;
        for (const table of ['plans','plan_versions','tasks','artifacts'])
        {
            // Only the approved source artifact survives the rolled back publication.
            const count = (await c.query('SELECT count(*)::int n FROM gameai.'+table+' WHERE project_id=$1',[p])).rows[0].n;
            assert.equal(count,table === 'artifacts' ? 1 : 0);
        }
        await c.query("INSERT INTO gameai.approval_workflows(version_id,project_id,requested_by,revision,document_hash,state,agent_policy) VALUES($1,$2,$3,$4,$5,'manual_pm',$6)",[request.version_id,p,user,request.revision,request.document_hash,JSON.stringify([{id:agent,role_code:'PM'}])]);
        await publishPmPlan(servicePool,key,started.job,result);
        const rows = (await c.query('SELECT * FROM gameai.tasks WHERE project_id=$1',[p])).rows;
        assert.equal(rows.length,4);
        assert.equal(rows.filter(row => row.logical_id).length,3);
        assert.equal(rows.filter(row => row.dispatch_allowed).length,0);
        assert.deepEqual(rows.filter(row => row.logical_id).map(row => row.logical_id).sort(),plan.tasks.map(row => row.id).sort());
        assert.equal(rows.some(row => ['Development','QA'].includes(row.role_code)),false);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.task_dependencies WHERE project_id=$1',[p])).rows[0].n,3);
        const htmlDocs = (await c.query('SELECT d.bytes FROM gameai.artifact_links l JOIN gameai.document_contents d ON d.artifact_id=l.artifact_id WHERE l.task_id=ANY($1::uuid[])',[rows.map(row => row.id)])).rows;
        assert.equal(htmlDocs.length,3);
        assert.ok(htmlDocs.every(row => row.bytes.toString().includes('完整窗口说明')));
        assert.equal((await publishPmPlan(servicePool,key,started.job,result)).state,'completed');
        await recoveryLoopScenario({c,servicePool,p,worker,user,key,rows});
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.tasks WHERE project_id=$1',[p])).rows[0].n,4);
        await c.query('SAVEPOINT identity_constraint');
        await assert.rejects(c.query('UPDATE gameai.tasks SET delivery_phase=null WHERE id=$1',[rows.find(row => row.logical_id).id]),/task_delivery_identity/);
        await c.query('ROLLBACK TO SAVEPOINT identity_constraint');
        const stale = await submit('v2');
        await assert.rejects(publishPmPlan(servicePool,key,started.job,result),/最新/);
        await reviewRequirement(servicePool,key,user,{...stale,decision:'approved',reason:''});
        for (let i=0;i<3;i++)
        {
            const retry = await startPmJob(servicePool,key,user,stale);
            await failPmJob(servicePool,retry.job,'测试失败');
        }
        await assert.rejects(startPmJob(servicePool,key,user,stale),/3 次/);
        await assert.rejects(submit('v3','<!doctype html><html><body><section id="W01">Legacy document without contract</section></body></html>'),/ui-production-contract/);

    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
