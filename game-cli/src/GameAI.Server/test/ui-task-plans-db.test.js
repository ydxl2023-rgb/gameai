import {prepareDesignDocument,sealDesignReview} from '../src/database/design-contract.js';
import {submitRequirement,reviewRequirement} from '../src/database/requirements.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createPool} from '../src/database/connection.js';
import {registerContract,submitTaskPlan,readTaskInput} from '../src/database/ui-task-plans.js';
import {fixture} from './ui-production-fixture.js';
test('approved, atomic, immutable and idempotent contract publication',async()=>{
 const pool=createPool();const c=await pool.connect();let inject=false;
 const adapter={connect:async()=>({query:(sql,args)=>{
 if(inject && sql.includes('INSERT INTO gameai.tasks') && args[4]==='Art')throw Error('injected');
 return c.query(sql==='BEGIN'?'SAVEPOINT api':sql==='COMMIT'?'RELEASE SAVEPOINT api':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT api':sql,args);
 },release(){}})};
 try{
 await c.query('BEGIN');const {contract,plan}=fixture();const user=randomUUID();const requirement=randomUUID();
 await c.query("INSERT INTO gameai.projects(id,project_key,name,is_test) VALUES($1,$2,'contract test',true)",[plan.projectId,'CONTRACT-'+randomUUID()]);
 await c.query("INSERT INTO gameai.users(id,subject,display_name,enabled) VALUES($1,$2,'test',true)",[user,'contract-test-'+user]);
 const role=(await c.query("SELECT role_code FROM gameai.role_permissions WHERE permission_code='requirement.approve' LIMIT 1")).rows[0].role_code;
 await c.query('INSERT INTO gameai.user_roles(project_id,user_id,role_code) VALUES($1,$2,$3)',[plan.projectId,user,role]);
 const prepared=prepareDesignDocument({html:'<!doctype html><html><body><section id="W01"><h1>Test login</h1><p>Complete window requirements for fixture.</p></section></body></html>',spec:{...contract,schemaVersion:'ui-design-spec/1'}});
 const html=sealDesignReview({html:prepared.html,review:{passed:true,issues:[],summary:'Reviewed fixture',documentHash:prepared.documentHash,contractHash:prepared.contractHash,executionId:'test-review',threadId:'test-thread'}}).html;
 const bytes=Buffer.from(html);
 const key=(await c.query('SELECT project_key FROM gameai.projects WHERE id=$1',[plan.projectId])).rows[0].project_key;
 const submission={request_id:randomUUID(),requirement_key:'TEST',title:'test',version:'v1',html,sha256:createHash('sha256').update(bytes).digest('hex'),execution_id:'test-review',thread_id:'test-thread',summary:'test'};
 const submitted=await submitRequirement(adapter,key,submission);
 assert.equal(submitted.version_id,contract.requirementVersionId);
 assert.equal((await submitRequirement(adapter,key,submission)).version_id,submitted.version_id);
 const actualRequirement=(await c.query('SELECT requirement_id FROM gameai.requirement_versions WHERE id=$1',[submitted.version_id])).rows[0].requirement_id;
 await assert.rejects(registerContract(adapter,contract,user),/approved/);
 await reviewRequirement(adapter,key,user,{version_id:submitted.version_id,revision:submitted.revision,document_hash:submitted.document_hash,decision:'approved'});
 await assert.rejects(registerContract(adapter,contract,randomUUID()),/permission/);
 const changed=structuredClone(contract);changed.windows[0].nodes[0].active=false;
 await assert.rejects(registerContract(adapter,changed,user),/exact contract/);
 assert.equal((await registerContract(adapter,contract,user)).created,true);assert.equal((await registerContract(adapter,contract,user)).created,false);
 const parent=(await c.query('INSERT INTO gameai.plans(project_id,requirement_id) VALUES($1,$2) RETURNING id',[plan.projectId,actualRequirement])).rows[0].id;
 const pv=(await c.query("INSERT INTO gameai.plan_versions(project_id,plan_id,requirement_version_id,version,state) VALUES($1,$2,$3,1,'published') RETURNING id",[plan.projectId,parent,plan.requirementVersionId])).rows[0].id;
 await c.query("INSERT INTO gameai.tasks(id,project_id,plan_version_id,title,role_code) VALUES($1,$2,$3,'test','PM')",[plan.parentTaskId,plan.projectId,pv]);
 assert.equal((await submitTaskPlan(adapter,plan,user,false)).tasks.length,3);
 inject=true;await assert.rejects(submitTaskPlan(adapter,plan,user,true),/injected/);inject=false;
 assert.equal((await c.query('SELECT count(*)::int n FROM gameai.tasks WHERE parent_id=$1',[plan.parentTaskId])).rows[0].n,0);
 const result=await submitTaskPlan(adapter,plan,user,true);assert.equal(result.tasks.length,3);
 assert.equal((await submitTaskPlan(adapter,plan,user,true)).replayed,true);
 await assert.rejects(submitTaskPlan(adapter,{...plan,requestId:randomUUID()},user,true),/already exist/);
 const input=await readTaskInput(c,result.tasks[2].id);assert.equal(input.content.dependencies.length,2);assert.equal(input.content.window.nodes.length,1);assert.match(input.content.deliveryDirectory,/deliveries\/F-/);
 await c.query('SAVEPOINT immutable');await assert.rejects(c.query("UPDATE gameai.ui_task_contracts SET input='{}' WHERE task_id=$1",[result.tasks[0].id]),/Immutable/);await c.query('ROLLBACK TO SAVEPOINT immutable');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
