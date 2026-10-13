import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptTask} from '../src/database/task-acceptance.js';

function fixture(status,permission=true)
{
    const queries=[];
    const client={release(){},async query(sql){
        queries.push(sql);
        if(sql.startsWith('SELECT id FROM gameai.projects')) return {rows:[{id:'project'}]};
        if(sql.includes('JOIN gameai.user_roles')) return {rowCount:permission?1:0};
        if(sql.startsWith('SELECT * FROM gameai.tasks')) return {rows:[{id:'task',parent_id:'root',role_code:'Prefab',status}]};
        return {rows:[],rowCount:0};
    }};
    return {pool:{async connect(){return client;}},queries};
}
const input={task_id:'57c1cb13-0b77-481b-b6b5-f89052dfa6c0'};
test('acceptance rejects unauthorized users without mutations',async()=>{
    const f=fixture('review',false);
    await assert.rejects(acceptTask(f.pool,'DEMO','user',input),/权限/);
    assert.ok(f.queries.includes('ROLLBACK'));
    assert.ok(!f.queries.some(q=>q.startsWith('UPDATE')));
});
test('acceptance cannot complete a running task',async()=>{
    const f=fixture('running');
    await assert.rejects(acceptTask(f.pool,'DEMO','user',input),/待验收/);
});
test('repeated acceptance is idempotent',async()=>{
    const f=fixture('completed');
    assert.equal((await acceptTask(f.pool,'DEMO','user',input)).repeated,true);
    assert.ok(!f.queries.some(q=>q.startsWith('INSERT')||q.startsWith('UPDATE')));
});
