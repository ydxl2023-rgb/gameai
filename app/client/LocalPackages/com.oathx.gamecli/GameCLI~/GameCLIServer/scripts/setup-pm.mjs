import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { createPool } from '../src/database/connection.js';

// Grant only the added publication operations; preserve human accounts and their passwords.
const pool = createPool();
try
{
    const config = parseEnv(await readFile(new URL('../.env.workflow',import.meta.url),'utf8'));
    if (!config.PGUSER)
    {
        throw new Error('Workflow database account missing');
    }
    const role = pg.escapeIdentifier(config.PGUSER);
    await pool.query('GRANT SELECT,INSERT,UPDATE ON gameai.pm_jobs TO '+role);
    await pool.query('GRANT INSERT ON gameai.plans,gameai.plan_versions,gameai.tasks,gameai.task_dependencies TO '+role);
    await pool.query('GRANT UPDATE(dispatch_allowed,dispatch_revision,dispatch_selected_by,dispatch_selected_at) ON gameai.tasks TO '+role);
    await pool.query('GRANT SELECT,INSERT ON gameai.task_dispatch_jobs TO '+role);
    await pool.query('GRANT INSERT,UPDATE ON gameai.executions TO '+role);
    await pool.query('GRANT UPDATE(status,progress) ON gameai.tasks TO '+role);
    await pool.query('GRANT SELECT,INSERT,UPDATE ON gameai.plan_dispatch_flows TO '+role);
    await pool.query('GRANT INSERT ON gameai.comments TO '+role);
    await pool.query('GRANT SELECT,INSERT,UPDATE ON gameai.qa_defects TO '+role);
    await pool.query('GRANT UPDATE(bound_agent_id) ON gameai.tasks TO '+role);
    await pool.query('GRANT SELECT,INSERT,UPDATE ON gameai.approval_workflows TO '+role);
    await pool.query('GRANT UPDATE(auto_execute,automation_revision) ON gameai.agents TO '+role);
    console.log('PM 任务发布所需数据库权限已配置。');
}
finally
{
    await pool.end();
}
