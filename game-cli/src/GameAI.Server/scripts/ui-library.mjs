import { loadBatch, importBatch } from '../src/ui-library/library.js';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Local maintenance adapter. Credentials remain in the server environment.
const [action, input, flag, assetRoot] = process.argv.slice(2);
let pool;
try
{
    if (!['validate', 'import', 'prepare-restore', 'search', 'register-preview'].includes(action) || !input)
    {
        throw new Error('Expected validate|import <directory> or prepare-restore <versionId> <output> <assetRoot>');
    }
    if (['validate', 'import'].includes(action) && flag && flag !== '--dry-run') throw new Error('Unknown flag');
    const batch = ['validate', 'import'].includes(action) ? await loadBatch(input) : null;
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
        if (action === 'search')
        {
            const { searchTemplates } = await import('../src/ui-library/catalog.js');
            console.log(JSON.stringify(await searchTemplates(pool, input, flag)));
        }
        else if (action === 'register-preview')
        {
            const { registerPreview } = await import('../src/ui-library/catalog.js');
            console.log(JSON.stringify(await registerPreview(pool, input, flag)));
        }
        else if (action === 'prepare-restore')
        {
            const { prepareRestore } = await import('../src/ui-library/restore.js');
            const result = await prepareRestore(pool, input, flag, assetRoot);
            console.log(JSON.stringify(result));
            if (!result.success) process.exitCode = 2;
        }
        else
        {
            console.log(JSON.stringify(await importBatch(pool, batch, flag === '--dry-run')));
        }
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
