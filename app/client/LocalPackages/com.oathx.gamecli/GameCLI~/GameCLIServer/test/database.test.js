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
        assert.ok(after.workbench.versions.length >= 2);
        assert.ok(after.workbench.requirements.some(row => row.id === 'LOGIN-7'));
        assert.ok(after.workbench.agents.every(a => ['离线', '已停用'].includes(a.status) && a.used === 0));
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

test('Agent configuration persists skills atomically and rejects mismatched skills, capacity and duplicates', async () =>
{
    const { createAgent } = await import('../src/database/agents.js');
    const { randomUUID } = await import('node:crypto');
    const pool = createPool();
    const c = await pool.connect();
    await c.query('BEGIN');
    const transactionalPool = { connect: async () => ({
        query: (sql, args) => c.query(sql === 'BEGIN' ? 'SAVEPOINT agent_operation' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT agent_operation' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT agent_operation' : sql, args),
        release() {}
    }) };
    try
    {
        const key = 'TEST-' + randomUUID();
        const project = (await c.query('INSERT INTO gameai.projects(project_key,name,is_test) VALUES($1,$1,true) RETURNING id', [key])).rows[0].id;
        const worker = (await c.query("INSERT INTO gameai.workers(project_id,worker_key,name,capacity) VALUES($1,'test','事务测试节点',2) RETURNING id", [project])).rows[0].id;
        const payload = { request_id: randomUUID(), name: '事务测试策划', role: 'Design', worker_id: worker, primary_skill: 'gameai-design', extra_skills: ['gameai-common'], capacity: 2, enabled: true };
        const first = await createAgent(transactionalPool, key, payload);
        assert.equal((await createAgent(transactionalPool, key, payload)).id, first.id);
        assert.equal((await c.query('SELECT count(*)::int count FROM gameai.agent_skills WHERE project_id=$1', [project])).rows[0].count, 2);
        assert.equal((await c.query("SELECT count(*)::int count FROM gameai.agent_grants WHERE project_id=$1 AND permission_code<>'project.read'", [project])).rows[0].count, 0);
        await assert.rejects(createAgent(transactionalPool, key, { ...payload, name: 'changed' }), /请求编号/);
        await assert.rejects(createAgent(transactionalPool, key, { ...payload, request_id: randomUUID() }), /同名/);
        await assert.rejects(createAgent(transactionalPool, key, { ...payload, request_id: randomUUID(), primary_skill: 'gameai-art' }), /主技能/);
        await assert.rejects(createAgent(transactionalPool, key, { ...payload, request_id: randomUUID(), extra_skills: ['gameai-art'] }), /主技能/);
        await assert.rejects(createAgent(transactionalPool, key, { ...payload, request_id: randomUUID(), capacity: 3 }), /容量/);
        await assert.rejects(createAgent(transactionalPool, key, { ...payload, request_id: randomUUID(), worker_id: randomUUID() }), /节点/);
        assert.equal((await c.query('SELECT count(*)::int count FROM gameai.agents WHERE project_id=$1', [project])).rows[0].count, 1);
        assert.equal((await c.query("SELECT has_table_privilege('gameai_agent_manager','gameai.approvals','INSERT') allowed")).rows[0].allowed, false);
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});

test('restricted Agent manager can save configuration without granting execution authority', async () =>
{
    const { parseEnv } = await import('node:util');
    const { readFile } = await import('node:fs/promises');
    const { randomUUID } = await import('node:crypto');
    const { createAgent } = await import('../src/database/agents.js');
    const config = parseEnv(await readFile(new URL('../.env.agent-manager', import.meta.url), 'utf8'));
    const pool = createPool({ user: config.PGUSER, password: config.PGPASSWORD });
    const c = await pool.connect();
    await c.query('BEGIN');
    try
    {
        const worker = (await c.query("SELECT w.id FROM gameai.workers w JOIN gameai.projects p ON p.id=w.project_id WHERE p.project_key='DEMO' LIMIT 1")).rows[0].id;
        const adapter = { connect: async () => ({ query: (sql, args) => c.query(sql === 'BEGIN' ? 'SAVEPOINT operation' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT operation' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT operation' : sql, args), release() {} }) };
        const result = await createAgent(adapter, 'DEMO', { request_id: randomUUID(), name: '回滚验证-' + randomUUID(), role: 'Art', worker_id: worker, primary_skill: 'gameai-art', extra_skills: [], capacity: 1, enabled: false });
        assert.ok(result.id.startsWith('art-'));
        const stored = (await c.query('SELECT display_name,enabled FROM gameai.agents WHERE agent_key=$1', [result.id])).rows[0];
        assert.equal(stored.enabled, false);
        assert.equal((await c.query("SELECT has_table_privilege(current_user,'gameai.tasks','INSERT') allowed")).rows[0].allowed, false);
    }
    finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
});
