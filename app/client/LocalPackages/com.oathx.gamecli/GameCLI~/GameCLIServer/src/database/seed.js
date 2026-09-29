import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function seed(pool)
{
    const data = JSON.parse(await readFile(new URL('../track/workbench.json', import.meta.url), 'utf8'));
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(70928002)');
        await client.query('SET LOCAL search_path=gameai,public');
        const existing = await client.query("SELECT id FROM projects WHERE project_key='DEMO'");
        if (existing.rowCount)
        {
            // Re-running setup never overwrites edits or synthesizes missing business records.
            await client.query('COMMIT');
            return { inserted: false };
        }
        const project = (await client.query('INSERT INTO projects(project_key,name,is_test) VALUES($1,$2,true) RETURNING id', [data.project.key, data.project.name])).rows[0].id;
        const requirement = (await client.query("INSERT INTO requirements(project_id,requirement_key,title) VALUES($1,'LOGIN-7',$2) RETURNING id", [project, data.requirement.title])).rows[0].id;
        const versions = {};
        for (const [index, version] of ['v1.2', 'v1.3'].entries())
        {
            const content = { summary: data.requirement.summary, rules: data.requirement.rules, changes: version === 'v1.3' ? data.requirement.changes : ['测试历史版本；未导入任何正式审批。'], is_excerpt: true };
            const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
            versions[version] = (await client.query(`INSERT INTO requirement_versions(project_id,requirement_id,version,ordinal,content,content_hash)
                VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [project, requirement, version, index + 1, content, hash])).rows[0].id;
        }
        const plan = (await client.query('INSERT INTO plans(project_id,requirement_id) VALUES($1,$2) RETURNING id', [project, requirement])).rows[0].id;
        const planVersion = (await client.query('INSERT INTO plan_versions(project_id,plan_id,requirement_version_id,version) VALUES($1,$2,$3,1) RETURNING id', [project, plan, versions['v1.2']])).rows[0].id;
        for (const agent of data.agents)
        {
            const worker = (await client.query('INSERT INTO workers(project_id,worker_key,name,capacity) VALUES($1,$2,$3,$4) RETURNING id', [project, agent.id + '-worker', agent.station, agent.capacity])).rows[0].id;
            const id = (await client.query('INSERT INTO agents(project_id,agent_key,role_code,worker_id) VALUES($1,$2,$3,$4) RETURNING id', [project, agent.id, agent.role, worker])).rows[0].id;
            await client.query("INSERT INTO agent_grants(project_id,agent_id,permission_code) VALUES($1,$2,'project.read')", [project, id]);
        }
        const taskIds = {};
        for (const task of data.tasks)
        {
            taskIds[task.id] = (await client.query(`INSERT INTO tasks(project_id,plan_version_id,title,role_code,status)
                VALUES($1,$2,$3,$4,$5) RETURNING id`, [project, planVersion, task.title, task.role, task.dependencies.length ? 'blocked' : 'pending'])).rows[0].id;
        }
        for (const task of data.tasks)
        {
            for (const dependency of task.dependencies)
            {
                await client.query('INSERT INTO task_dependencies(project_id,task_id,depends_on_id) VALUES($1,$2,$3)', [project, taskIds[task.id], taskIds[dependency]]);
            }
        }
        await client.query("INSERT INTO audit_events(project_id,actor,event,payload) VALUES($1,'system:seed','导入小样测试数据；所有节点离线、任务未派工，无正式审批。',$2)", [project, { source: 'workbench.json', tasks: 4, agents: 6 }]);
        await client.query('COMMIT');
        return { inserted: true };
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        throw error;
    }
    finally
    {
        client.release();
    }
}
