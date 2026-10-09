import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function migrate(pool)
{
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(70928001)');
        await client.query(`CREATE TABLE IF NOT EXISTS public.gameai_migrations (
            name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
        const directory = new URL('../../migrations/', import.meta.url);
        for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort())
        {
            const sql = await readFile(new URL(name, directory), 'utf8');
            const checksum = createHash('sha256').update(sql).digest('hex');
            const existing = await client.query('SELECT checksum FROM public.gameai_migrations WHERE name=$1', [name]);
            if (existing.rowCount)
            {
                if (existing.rows[0].checksum !== checksum)
                {
                    throw new Error('已执行迁移被修改，请新增迁移文件。');
                }
                continue;
            }
            await client.query(sql);
            await client.query('INSERT INTO public.gameai_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        }
        await client.query('COMMIT');
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
