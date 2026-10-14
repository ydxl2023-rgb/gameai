import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Prepare only data and content-addressed binaries. Unity changes belong to GameCLI/UnityCLI.
export async function prepareRestore(pool, versionId, output, assetRoot)
{
    if (!/^[1-9][0-9]*$/.test(versionId)) throw new Error('Expected positive version ID');
    if (!/^Assets\/[A-Za-z0-9_/-]+$/.test(assetRoot) || assetRoot.split('/').some(part => !part)) throw new Error('Invalid destination asset root');
    await mkdir(output, { recursive: true });
    if ((await readdir(output)).length) throw new Error('Output directory must be empty');
    const { rows: [version] } = await pool.query('SELECT document,diagnostics,content_hash FROM ui_library.versions WHERE id=$1', [versionId]);
    if (!version) throw new Error('Template version does not exist');
    const { rows: [visual] } = await pool.query('SELECT document FROM ui_library.visual_bindings WHERE version_id=$1', [versionId]);
    if (!visual) throw new Error('Version has no visual evidence; export/import again');
    const { rows } = await pool.query('SELECT r.resource_id,r.descriptor,b.bytes FROM ui_library.visual_resources r LEFT JOIN ui_library.visual_blobs b ON r.blob_hash=b.hash WHERE version_id=$1 ORDER BY resource_id', [versionId]);
    const document = structuredClone(version.document);
    const resources = new Map(rows.map(row => [row.resource_id, row]));
    const imports = new Map();
    const blockers = [];
    const warnings = [];
    document.visualTextures = [];
    for (const binding of visual.document.bindings)
    {
        const node = document.prefab.nodes.find(node => node.id === binding.nodeId);
        const component = node?.components.find(component => component.id === binding.componentId);
        if (!component)
        {
            blockers.push({ code: 'unsupported-visual-component', binding });
            continue;
        }
        const row = resources.get(binding.resourceId);
        const resource = row?.descriptor;
        const sprite = binding.property === 'm_Sprite';
        const font = binding.property === 'm_FontData.m_Font';
        if ((!sprite && !font) || !resource?.blob || !row.bytes)
        {
            blockers.push({ code: 'unsupported-or-missing-visual-resource', binding });
            continue;
        }
        const extension = resource.blob.extension;
        if (!(sprite ? ['.png', '.jpg', '.jpeg', '.tga'] : ['.ttf', '.otf', '.ttc']).includes(extension))
        {
            blockers.push({ code: 'unsupported-binary-format', binding });
            continue;
        }
        if (sprite && Number(resource.importer?.TextureImporter?.spriteMode) !== 1)
        {
            blockers.push({ code: 'sprite-sheet-adapter-required', binding });
            continue;
        }
        const digest = createHash('sha256').update(row.bytes).digest('hex');
        if (digest !== resource.blob.sha256 || row.bytes.length !== resource.blob.byteLength) throw new Error('Stored binary integrity failure');
        const name = digest + extension;
        const target = assetRoot + '/' + name;
        if (!imports.has(digest))
        {
            const file = path.join(output, name);
            await writeFile(file, row.bytes);
            imports.set(digest, { file, target, sha256: digest });
            if (sprite) document.visualTextures.push({ path: target, settings: resource.importer.TextureImporter });
        }
        component.properties[binding.property] = { assetPath: target };
    }
    if (visual.document.components.length) blockers.push({ code: 'animation-or-effect-adapter-required', count: visual.document.components.length });
    for (const node of document.prefab.nodes)
    {
        for (const component of node.components)
        {
            if (component.type === 'UnityEngine.UI.Text')
            {
                const text = component.properties.m_Text ?? '';
                if (!text || /\[LID:/.test(text)) warnings.push({ code: 'dynamic-text-preserved', node: node.name, value: text });
            }
        }
    }
    warnings.push(...version.diagnostics.filter(item => ['unsupported-component', 'business-callback-excluded', 'sv-text-presentation-adapter'].includes(item.code)));
    const nodesById = new Map(document.prefab.nodes.map(node => [node.id, node]));
    const visible = node => node.active !== false && (node.parentId == null || visible(nodesById.get(node.parentId)));
    if (!document.prefab.nodes.some(node => visible(node) && node.components.some(component => ['UnityEngine.UI.Image', 'UnityEngine.UI.Text'].includes(component.type))))
    {
        blockers.push({ code: 'no-active-visuals', message: 'Source visuals are hidden; an explicit preview state is required. No nodes were force-enabled.' });
    }
    const snapshot = path.join(output, 'restore.json');
    document.visualPreview = { width: 1280, height: 720, output: path.join(output, 'preview.png') };
    await writeFile(snapshot, JSON.stringify(document, null, 2));
    const plan = { success: blockers.length === 0, versionId, contentHash: version.content_hash, snapshot, imports: [...imports.values()], blockers, warnings, scope: 'Static appearance only; custom behavior and dynamic text are not recreated.' };
    await writeFile(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2));
    return plan;
}
