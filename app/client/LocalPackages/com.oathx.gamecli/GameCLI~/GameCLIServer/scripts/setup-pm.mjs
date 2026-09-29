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
    console.log('PM 任务发布所需数据库权限已配置。');
}
finally
{
    await pool.end();
}
