import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const configFile = fileURLToPath(new URL('../../.env.database', import.meta.url));
if (process.env.GAMEAI_STORAGE !== 'demo' && existsSync(configFile))
{
    loadEnvFile(configFile);
}

export function databaseEnabled()
{
    return process.env.GAMEAI_STORAGE === 'postgres';
}

export function createPool()
{
    if (!databaseEnabled() || !process.env.PGPASSWORD || !process.env.PGDATABASE || !process.env.PGUSER)
    {
        throw new Error('数据库未配置，请检查 .env.database。');
    }
    const pool = new pg.Pool({
        host: process.env.PGHOST ?? '127.0.0.1',
        port: Number(process.env.PGPORT ?? 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        max: 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        statement_timeout: 10000,
        application_name: 'gameai-track',
        allowExitOnIdle: true
    });
    pool.on('error', () => console.error('数据库连接中断，下次读取将重连。'));
    return pool;
}
