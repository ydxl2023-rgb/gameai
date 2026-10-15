import { enrichExport } from '../src/ui-library/analysis.js';

const args = process.argv.slice(2);
if (args.length !== 4)
{
    throw new Error('enrich-ui-export.mjs <input-package> <new-output-package> <analysis.json> <source-project>');
}
console.log(JSON.stringify(await enrichExport(...args)));
