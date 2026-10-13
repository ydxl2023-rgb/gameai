import { loadBatch, importBatch } from '../src/ui-library/library.js';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Local maintenance adapter. Credentials remain in the server environment.
const [action, input, flag] = process.argv.slice(2);
let pool;
try
{
    if (!['validate', 'import'].includes(action) || !input || (flag && flag !== '--dry-run'))
    {
        throw new Error('Usage: ui-library.mjs validate|import <export-directory> [--dry-run]');
    }
    const batch = await loadBatch(input);
    if (action === 'validate')
    {
        console.log(JSON.stringify({ success: true, sourceKey: batch.sourceKey, count: batch.entries.length, entries: batch.entries.map(entry => ({ guid: entry.guid, grade: entry.grade, diagnostics: entry.diagnostics })) }));
    }
    else
    {
        const environment = fileURLToPath(new URL('../.env.workflow', import.meta.url));
        if (existsSync(environment) && !process.env.PGUSER)
        {
            loadEnvFile(environment);
        }
        const { createPool } = await import('../src/database/connection.js');
        pool = createPool();
        console.log(JSON.stringify(await importBatch(pool, batch, flag === '--dry-run')));
    }
}
catch (error)
{
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exitCode = 4;
}
finally
{
    await pool?.end();
}
