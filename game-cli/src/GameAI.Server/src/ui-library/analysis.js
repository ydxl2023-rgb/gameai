import { createHash } from 'node:crypto';
import { readFile, realpath, mkdir, cp, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { loadBatch } from './library.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const requireText = (value, key) =>
{
    if (typeof value !== 'string' || value.trim().length === 0)
    {
        throw new Error(`Missing analysis field: ${key}`);
    }
};

export function validateAnalysis(item, sourceHash, fields)
{
    if (!sourceHash || item.sourceHash !== sourceHash)
    {
        throw new Error('Analysis does not match source content hash.');
    }
    for (const key of fields)
    {
        requireText(item[key], key);
    }
    requireText(item.method, 'method');
    return { ...item, status: 'analyzed', runtimeVerified: false };
}

// Reviewed interpretations are versioned evidence, never executable source or automatic approval.
export async function enrichExport(input, output, analysisFile, sourceProject)
{
    await loadBatch(input);
    const root = await realpath(sourceProject);
    const analysis = JSON.parse(await readFile(analysisFile, 'utf8'));
    if (analysis.schemaVersion !== 'ui-source-analysis/1')
    {
        throw new Error('Unsupported analysis schema.');
    }
    const manifest = JSON.parse(await readFile(path.join(input, 'manifest.json'), 'utf8'));
    const resources = new Map(manifest.visualResources.map(resource => [resource.id, resource]));
    const extraBlobs = new Map();
    for (const resource of resources.values())
    {
        if (resource.status === 'adapter-required' && resource.sourcePath?.toLowerCase().endsWith('.wav'))
        {
            const file = await realpath(path.resolve(root, resource.sourcePath));
            const relative = path.relative(root, file);
            if (relative.startsWith('..') || path.isAbsolute(relative))
            {
                throw new Error('Audio path escapes source project.');
            }
            const bytes = await readFile(file);
            if (digest(bytes) !== resource.sourceHash || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
            {
                throw new Error('Audio source mismatch or unsupported WAV container.');
            }
            resource.kind = 'audio';
            resource.status = 'source-evidence';
            resource.blob = { file: `blobs/${resource.sourceHash}.wav`, sha256: resource.sourceHash, byteLength: bytes.length, extension: '.wav' };
            resource.limitations = ['Original WAV preserved; playback mapping belongs to target runtime.'];
            extraBlobs.set(resource.blob.file, bytes);
        }
    }
    for (const entry of analysis.textures ?? [])
    {
        const resource = resources.get(entry.resourceId);
        if (resource?.kind !== 'texture')
        {
            throw new Error('Texture analysis targets missing resource.');
        }
        const style = validateAnalysis(entry, resource.sourceHash, ['family', 'palette', 'shape', 'surface', 'lighting', 'composition', 'usage', 'regeneration']);
        resource.textureFeatures = { ...resource.textureFeatures, styleAnalysisStatus: 'complete', style };
    }
    for (const entry of analysis.shaders ?? [])
    {
        const resource = resources.get(entry.resourceId);
        if (resource?.kind !== 'shader-description')
        {
            throw new Error('Shader analysis targets missing resource.');
        }
        resource.implementation = validateAnalysis(entry, resource.sourceHash, ['purpose', 'inputs', 'algorithm', 'renderStates', 'dependencies', 'porting', 'verification']);
        resource.status = 'implementation-analyzed';
    }
    const principles = {};
    for (const entry of analysis.components ?? [])
    {
        const file = await realpath(path.resolve(root, entry.sourcePath));
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(file) !== '.cs')
        {
            throw new Error('Component source must be a C# file within source project.');
        }
        const metadata = await readFile(`${file}.meta`, 'utf8');
        if (!metadata.includes(`guid: ${entry.guid}`))
        {
            throw new Error('Component GUID and source path mismatch.');
        }
        principles[entry.guid] = validateAnalysis(entry, digest(await readFile(file)), ['name', 'principle', 'inputs', 'visualImpact', 'reconstruction']);
    }
    const visualFiles = new Map();
    for (const entry of manifest.entries)
    {
        const visual = JSON.parse(await readFile(path.join(input, entry.visualFile), 'utf8'));
        visual.componentPrinciples = {};
        for (const component of visual.sourceComponentInventory ?? [])
        {
            if (principles[component.scriptGuid])
            {
                component.status = 'principle-only';
                component.requiresPrinciple = true;
                component.principleRef = component.scriptGuid;
                visual.componentPrinciples[component.scriptGuid] = principles[component.scriptGuid];
            }
        }
        visualFiles.set(entry.visualFile, visual);
    }
    const builtin = resources.get('0000000000000000f000000000000000');
    if (builtin?.status === 'unresolved')
    {
        builtin.kind = 'unity-builtin';
        builtin.status = 'symbolic-reference';
        builtin.references = [...visualFiles.values()].flatMap(visual => visual.bindings.filter(binding => binding.resourceId === builtin.id));
        builtin.limitations = ['Engine-owned resource, not a missing project file. Preserve source GUID and fileId; target Unity version must resolve and verify the actual subasset before reconstruction.'];
        builtin.runtimeVerified = false;
    }
    // The approved fallback applies only to unresolved font references, never missing sprites/materials.
    if (analysis.fontFallback?.policy === 'target-default')
    {
        requireText(analysis.fontFallback.reason, 'fontFallback.reason');
        const fontRefs = new Set();
        for (const resource of resources.values())
        {
            for (const reference of resource.importer?.TrueTypeFontImporter?.fallbackFontReferences ?? [])
            {
                fontRefs.add(reference.guid);
            }
        }
        for (const visual of visualFiles.values())
        {
            visual.fontFallbackPolicy = analysis.fontFallback;
            for (const binding of visual.bindings)
            {
                if (binding.property === 'm_FontData.m_Font' && binding.resourceId)
                {
                    fontRefs.add(binding.resourceId);
                }
            }
        }
        for (const id of fontRefs)
        {
            const resource = resources.get(id);
            if (resource?.status === 'unresolved')
            {
                resource.kind = 'font';
                resource.status = 'approved-fallback';
                resource.replacement = { policy: 'target-default', reason: analysis.fontFallback.reason, sourceGuid: id, sourceMissing: true, target: 'Unity built-in font; TMP uses target project default font asset', runtimeVerified: false };
            }
        }
    }
    const destination = path.resolve(output);
    const inputPath = await realpath(input);
    const relativeOutput = path.relative(inputPath, destination);
    if (!relativeOutput || (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput)))
    {
        throw new Error('Output must be outside input package.');
    }
    try
    {
        await access(destination);
        throw new Error('Output already exists.');
    }
    catch (error)
    {
        if (error.code !== 'ENOENT')
        {
            throw error;
        }
    }
    await mkdir(destination, { recursive: true });
    await cp(inputPath, destination, { recursive: true });
    for (const [file, bytes] of extraBlobs)
    {
        await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
        await writeFile(path.join(destination, file), bytes);
    }
    manifest.analysis = { schemaVersion: analysis.schemaVersion, sha256: digest(await readFile(analysisFile)), policy: 'reviewed-source-interpretation; not runtime acceptance' };
    for (const [file, visual] of visualFiles)
    {
        await writeFile(path.join(destination, file), JSON.stringify(visual, null, 2));
    }
    await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await loadBatch(destination);
    return { success: true, output: destination, textures: analysis.textures?.length ?? 0, shaders: analysis.shaders?.length ?? 0, componentTypes: Object.keys(principles).length };
}
