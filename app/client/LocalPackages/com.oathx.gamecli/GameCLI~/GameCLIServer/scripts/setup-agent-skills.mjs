import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import pg from 'pg';
import {createPool} from '../src/database/connection.js';
const pool=createPool();
try
{
    const config=parseEnv(await readFile(new URL('../.env.agent-manager',import.meta.url),'utf8'));
    if(!config.PGUSER) throw new Error('Agent manager configuration missing');
    await pool.query('GRANT SELECT ON gameai.agent_runs,gameai.agent_conversations TO '+pg.escapeIdentifier(config.PGUSER));
    console.log('Agent 技能管理执行占用查询权限已配置。');
}
finally {await pool.end();}
