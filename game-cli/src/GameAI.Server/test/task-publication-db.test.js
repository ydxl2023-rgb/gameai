import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../src/database/connection.js';

test('workflow journal and completion events are transactional and idempotent',async()=>
{
    const pool=createPool();
    const c=await pool.connect();
    const key='recovery-test:'+randomUUID();
    try
    {
        await c.query('BEGIN');
        const sample=(await c.query(`SELECT e.id,t.plan_version_id FROM gameai.executions e JOIN gameai.tasks t ON t.id=e.task_id
            JOIN gameai.projects p ON p.id=t.project_id WHERE p.is_test ORDER BY e.started_at DESC LIMIT 1`)).rows[0];
        assert.ok(sample,'Requires a test project execution');
        await c.query(`INSERT INTO gameai.task_publications(execution_id,job) VALUES($1,$2) ON CONFLICT DO NOTHING`,[sample.id,{executionId:sample.id}]);
        await c.query(`UPDATE gameai.task_publications SET response=$2,state='ready' WHERE execution_id=$1`,[sample.id,{result:{Text:'transactional test'}}]);
        await c.query(`INSERT INTO gameai.workflow_outbox(event_key,plan_version_id) VALUES($1,$2)`,[key,sample.plan_version_id]);
        const duplicate=await c.query(`INSERT INTO gameai.workflow_outbox(event_key,plan_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[key,sample.plan_version_id]);
        assert.equal(duplicate.rowCount,0);
        assert.equal((await pool.query('SELECT 1 FROM gameai.workflow_outbox WHERE event_key=$1',[key])).rowCount,0,'uncommitted event must not escape');
        await c.query('ROLLBACK');
        assert.equal((await pool.query('SELECT 1 FROM gameai.workflow_outbox WHERE event_key=$1',[key])).rowCount,0);
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
