import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../src/database/connection.js';
import {editTaskField,canEditTasks} from '../src/database/task-edits.js';

test('single-field edits enforce permission, revision, active state, cycles and atomic history (rollback)',async()=>{
    const pool=createPool();const c=await pool.connect();await c.query('BEGIN');
    const service={connect:async()=>({query:async(sql,args)=>{
        if(sql==='BEGIN')return c.query('SAVEPOINT operation');
        if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT operation');
        if(sql==='ROLLBACK'){await c.query('ROLLBACK TO SAVEPOINT operation');return c.query('RELEASE SAVEPOINT operation');}
        return c.query(sql,args);
    },release(){}})};
    try{
        const key='EDIT-'+randomUUID();
        const p=(await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id',[key])).rows[0].id;
        const user=(await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        const other=(await c.query('INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,$1,true) RETURNING id',[randomUUID()])).rows[0].id;
        await c.query("INSERT INTO gameai.user_roles VALUES($1,$2,'Design')",[p,user]);
        assert.equal(await canEditTasks(c,key,user),true);assert.equal(await canEditTasks(c,key,other),false);
        const r=(await c.query("INSERT INTO gameai.requirements(project_id,requirement_key,title) VALUES($1,'EDIT','编辑隔离测试') RETURNING id",[p])).rows[0].id;
        const v=(await c.query("INSERT INTO gameai.requirement_versions(project_id,requirement_id,version,ordinal,content,content_hash) VALUES($1,$2,'v1',1,'{}',$3) RETURNING id",[p,r,'0'.repeat(64)])).rows[0].id;
        const plan=(await c.query('INSERT INTO gameai.plans(project_id,requirement_id) VALUES($1,$2) RETURNING id',[p,r])).rows[0].id;
        const pv=(await c.query('INSERT INTO gameai.plan_versions(project_id,plan_id,requirement_version_id,version) VALUES($1,$2,$3,1) RETURNING id',[p,plan,v])).rows[0].id;
        const root=(await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code) VALUES($1,$2,'主任务','PM') RETURNING id",[p,pv])).rows[0].id;
        async function task(){return (await c.query("INSERT INTO gameai.tasks(project_id,plan_version_id,parent_id,title,role_code,description,dispatch_allowed,dispatch_selected_by,dispatch_selected_at) VALUES($1,$2,$3,'资源交付','Art','范围：原始范围',true,$4,now()) RETURNING id",[p,pv,root,user])).rows[0].id;}
        const a=await task(),b=await task();
        let input={task_id:a,revision:0,field:'scope',value:'修改后的范围',reason:'人工修正'};
        await assert.rejects(editTaskField(service,key,other,input),/权限/);
        const saved=await editTaskField(service,key,user,input);assert.equal(saved.revision,1);
        const row=(await c.query('SELECT * FROM gameai.tasks WHERE id=$1',[a])).rows[0];
        assert.equal(row.dispatch_allowed,false);assert.equal(row.dispatch_revision,1);assert.equal(row.description,'任务范围：修改后的范围');
        assert.equal((await c.query('SELECT before_value,after_value FROM gameai.task_edits WHERE task_id=$1',[a])).rows[0].before_value,'原始范围');
        await assert.rejects(editTaskField(service,key,user,input),/刷新/);
        input={...input,revision:1};assert.equal((await editTaskField(service,key,user,input)).changed,false);
        await editTaskField(service,key,user,{task_id:a,revision:1,field:'dependencies',value:[b]});
        await assert.rejects(editTaskField(service,key,user,{task_id:b,revision:0,field:'dependencies',value:[a]}),/循环/);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.task_dependencies WHERE task_id=$1',[b])).rows[0].n,0);
        await assert.rejects(editTaskField(service,key,user,{task_id:b,revision:0,field:'dependencies',value:[b]}),/自己/);
        for(const status of ['running','review','completed','cancelled']){
            await c.query('UPDATE gameai.tasks SET status=$2 WHERE id=$1',[a,status]);
            await assert.rejects(editTaskField(service,key,user,{task_id:a,revision:2,field:'success',value:'修改'}),/不可修改/);
        }
        await c.query("UPDATE gameai.tasks SET status='pending' WHERE id=$1",[a]);
        await c.query("UPDATE gameai.tasks SET status='running' WHERE id=$1",[a]);
        await assert.rejects(editTaskField(service,key,user,{task_id:b,revision:0,field:'scope',value:'修改'}),/返修/);
        assert.equal((await c.query('SELECT count(*)::int n FROM gameai.task_edits WHERE task_id=$1',[a])).rows[0].n,2);
    }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
