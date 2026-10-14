import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAssetPool, migrate, upload } from '../src/asset-library/library.js';
import { initializeIndex, indexPending, search } from '../src/asset-library/index.js';

const env = fileURLToPath(new URL('../.env.asset-library', import.meta.url));
if (existsSync(env))
{
    loadEnvFile(env);
}
const [action, ...args] = process.argv.slice(2);
let pool;
try
{
    pool = createAssetPool();
    let result;
    switch (action)
    {
        case 'migrate':
            result = await migrate(pool);
            break;
        case 'upload':
            if (args.length !== 2)
            {
                throw new Error('upload <export-directory> <root-guid>');
            }
            result = await upload(pool, args[0], args[1]);
            break;
        case 'index-init':
            result = await initializeIndex(pool);
            break;
        case 'index':
            result = await indexPending(pool, args[0]);
            break;
        case 'search':
            result = await search(pool, args[0], args[1]);
            break;
        case 'report':
            {
                const { report } = await import('../src/asset-library/report.js');
                result = await report(pool, args[0], args[1]);
                break;
            }
        default:
            throw new Error('Expected migrate|upload|index-init|index|search|report');
    }
    console.log(JSON.stringify(result));
    if (!result.success)
    {
        process.exitCode = 2;
    }
}
catch (error)
{
    // Never print a connection string or a nested network error containing credentials.
    const message = String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, '[database-url]');
    console.log(JSON.stringify({ success: false, error: message }));
    process.exitCode = 4;
}
finally
{
    await pool?.end();
}
