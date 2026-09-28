import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../src/database/connection.js';
import { migrate } from '../src/database/migrate.js';
import { seed } from '../src/database/seed.js';
import { readWorkbench } from '../src/database/store.js';

test('migration and seed are repeatable; data survives fresh connections', async () =>
{
    const pool = createPool();
    try
    {
        await migrate(pool);
        const before = await readWorkbench(pool, 'DEMO');
        assert.equal((await seed(pool)).inserted, false);
        const after = await readWorkbench(pool, 'DEMO');
        assert.deepEqual(after, before);
        assert.equal(after.workbench.tasks.length, 4);
        assert.equal(after.workbench.versions.length, 2);
        assert.ok(after.workbench.agents.every(a => a.status === '离线' && a.used === 0));
        assert.ok(after.workbench.tasks.every(t => t.progress === 0 && t.agent === null));
        await pool.end();
        const fresh = createPool();
        try
        {
            assert.deepEqual(await readWorkbench(fresh, 'DEMO'), before);
        }
        finally
        {
            await fresh.end();
        }
    }
    finally
    {
        if (!pool.ended) await pool.end();
    }
});

test('database rejects invalid graph, edits to versions, agent approval grants and unauthorised human approval', async () =>
{
    const pool = createPool();
    const c = await pool.connect();
    try
    {
        await c.query('BEGIN');
        await c.query('SET LOCAL search_path=gameai,public');
        const p = (await c.query("SELECT id FROM projects WHERE project_key='DEMO'")).rows[0].id;
        const tasks = (await c.query('SELECT task_key,id FROM tasks WHERE project_id=$1', [p])).rows;
        const ids = Object.fromEntries(tasks.map(t => [t.task_key, t.id]));
        async function denied(sql, params, code)
        {
            await c.query('SAVEPOINT expected_failure');
            await assert.rejects(c.query(sql, params), e => e.code === code);
            await c.query('ROLLBACK TO SAVEPOINT expected_failure');
        }
        await denied('INSERT INTO task_dependencies VALUES($1,$2,$3)', [p, ids['DEMO-1'], ids['DEMO-4']], 'P0001');
        await denied('INSERT INTO task_dependencies VALUES($1,$2,$2)', [p, ids['DEMO-1']], 'P0001');
        await denied("UPDATE requirement_versions SET version='bad' WHERE project_id=$1", [p], 'P0001');
        await denied("UPDATE tasks SET progress=101 WHERE id=$1", [ids['DEMO-1']], '23514');
        const agent = (await c.query('SELECT id FROM agents WHERE project_id=$1 LIMIT 1', [p])).rows[0].id;
        await denied("INSERT INTO agent_grants VALUES($1,$2,'requirement.approve')", [p, agent], '23514');
        const user = (await c.query("INSERT INTO users(subject,display_name,enabled) VALUES('transaction-only','测试',true) RETURNING id")).rows[0].id;
        const version = (await c.query('SELECT id FROM requirement_versions WHERE project_id=$1 LIMIT 1', [p])).rows[0].id;
        await denied("INSERT INTO approvals(project_id,version_id,user_id,decision) VALUES($1,$2,$3,'approved')", [p, version, user], 'P0001');
        const execution = (await c.query("INSERT INTO executions(project_id,task_id,agent_id,state) VALUES($1,$2,$3,'running') RETURNING id", [p, ids['DEMO-1'], agent])).rows[0].id;
        assert.ok(execution);
        await denied("INSERT INTO executions(project_id,task_id,agent_id,state) VALUES($1,$2,$3,'assigned')", [p, ids['DEMO-1'], agent], '23505');
        assert.equal((await c.query("SELECT has_table_privilege('gameai_track','gameai.tasks','UPDATE') allowed")).rows[0].allowed, false);
        assert.equal((await c.query("SELECT has_table_privilege('gameai_track','gameai.tasks','SELECT') allowed")).rows[0].allowed, true);
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});

test('linked HTML is original bytes, project scoped, and linking is idempotent', async () =>
{
    const { readLinkedHtml, linkDesignHtml, readDesignHtml } = await import('../src/database/documents.js');
    const pool = createPool();
    try
    {
        const before = await readWorkbench(pool, 'DEMO');
        const row = before.workbench.requirements.find(r => r.id === 'LOGIN-7');
        assert.ok(row.document_url);
        const id = row.document_url.split('/').at(-1);
        const expected = await readDesignHtml(row.document_path);
        assert.deepEqual(await readLinkedHtml(pool, 'DEMO', id), expected.bytes);
        assert.equal(await readLinkedHtml(pool, 'NOT_THIS_PROJECT', id), null);
        await assert.rejects(readDesignHtml('package.json'));
        await linkDesignHtml(pool, 'DEMO', 'LOGIN-7', 'v1.3', row.document_path);
        assert.deepEqual(await readWorkbench(pool, 'DEMO'), before);
    }
    finally { await pool.end(); }
});
