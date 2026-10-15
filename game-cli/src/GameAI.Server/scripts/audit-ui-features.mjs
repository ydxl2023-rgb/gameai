import { writeFile } from 'node:fs/promises';
import { loadBatch } from '../src/ui-library/library.js';
import { visualFeatures } from '../src/ui-library/features.js';

// A successful parse is not a completeness certificate. Incomplete evidence exits nonzero.
const [directory, output] = process.argv.slice(2);
if (!directory || !output)
{
    throw new Error('audit-ui-features.mjs <export-directory> <new-report.json>');
}
const batch = await loadBatch(directory);
const entries = batch.entries.map(entry => ({
    guid: entry.guid,
    name: entry.document.prefab.name,
    sourceRevision: entry.sourceRevision,
    ...visualFeatures(entry.visuals, entry.visual, entry.document),
}));
const report = { schemaVersion: 'ui-feature-audit/1', extractionComplete: entries.every(entry => entry.extractionComplete), entries };
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ extractionComplete: report.extractionComplete, entries: entries.map(entry => ({ guid: entry.guid, nodes: entry.hierarchy.length, components: entry.componentCount, blockers: entry.blockers.length })), output }));
process.exitCode = report.extractionComplete ? 0 : 4;
