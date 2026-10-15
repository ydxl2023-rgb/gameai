// Features are observed source evidence. Unsupported fields remain searchable blockers.
function analyzed(value, sourceHash, fields)
{
    return value?.status === 'analyzed' && /^[a-f0-9]{64}$/.test(sourceHash ?? '') && value.sourceHash === sourceHash
        && fields.every(field => typeof value[field] === 'string' && value[field].trim());
}
function serializedFeatures(resource)
{
    const result = [];
    function walk(value, path)
    {
        if (!value || typeof value !== 'object')
        {
            return;
        }
        if (!Array.isArray(value))
        {
            const selected = {};
            for (const key of ['path', 'attribute', 'classID', 'm_Name', 'm_Speed', 'm_SampleRate', 'm_WrapMode', 'm_LoopTime', 'm_StartTime', 'm_StopTime', 'm_ConditionEvent', 'm_ConditionMode', 'm_EventTreshold', 'm_Shader', 'm_Enabled', 'm_Motion', 'm_AnimationClip', 'm_Controller'])
            {
                if (Object.hasOwn(value, key))
                {
                    selected[key] = value[key];
                }
            }
            if (Object.keys(selected).length)
            {
                result.push({ path, values: selected });
            }
        }
        for (const [key, child] of Object.entries(value))
        {
            walk(child, `${path}/${key}`);
        }
    }
    for (const record of resource.records ?? [])
    {
        walk(record.parameters, `/${record.fileId}`);
    }
    walk(resource.parameters, '/component');
    return result;
}

export function visualFeatures(resources = [], visual = null, document = null)
{
    const groups = { animations: [], controllers: [], animationBindings: [], effects: [], materials: [], shaders: [], textures: [] };
    const target = { animation: 'animations', 'animation-controller': 'controllers', 'animation-binding': 'animationBindings', effect: 'effects', material: 'materials', 'shader-description': 'shaders', texture: 'textures' };
    const blockers = [];
    const hierarchy = (document?.prefab?.nodes ?? []).map(node => ({ id: node.id, parentId: node.parentId, name: node.name, siblingIndex: node.siblingIndex, rect: node.rect, components: node.components.map(item => ({ id: item.id, type: item.type })) }));
    if (!hierarchy.length)
    {
        blockers.push({ reason: 'hierarchy-evidence-missing' });
    }
    for (const resource of resources)
    {
        const key = target[resource.kind];
        if (key)
        {
            const record = {
                id: resource.id, path: resource.sourcePath ?? null, status: resource.status,
                dependencies: resource.dependencies ?? [],
                parameterSections: (resource.records ?? []).map(item => ({ classId: item.classId, fields: Object.keys(item.parameters ?? {}) })),
                features: serializedFeatures(resource),
            };
            if (resource.kind === 'texture')
            {
                record.width = resource.width ?? null;
                record.height = resource.height ?? null;
                record.features = resource.textureFeatures ?? { status: 'not-extracted' };
            }
            if (resource.kind === 'shader-description')
            {
                record.implementation = resource.implementation ?? null;
            }
            groups[key].push(record);
        }
        if (['unresolved', 'parse-failed', 'adapter-required', 'analysis-required'].includes(resource.status))
        {
            blockers.push({ resourceId: resource.id, reason: resource.status });
        }
        if (resource.kind === 'shader-description' && !analyzed(resource.implementation, resource.sourceHash, ['purpose', 'inputs', 'algorithm', 'renderStates', 'dependencies', 'porting', 'verification', 'method']))
        {
            blockers.push({ resourceId: resource.id, reason: 'shader-implementation-not-analyzed' });
        }
        if (resource.kind === 'texture' && resource.textureFeatures?.pixelAnalysisStatus !== 'complete')
        {
            blockers.push({ resourceId: resource.id, reason: 'texture-pixel-features-incomplete' });
        }
        if (resource.kind === 'texture' && (resource.textureFeatures?.styleAnalysisStatus !== 'complete'
            || !analyzed(resource.textureFeatures?.style, resource.sourceHash, ['family', 'palette', 'shape', 'surface', 'lighting', 'composition', 'usage', 'regeneration', 'method'])))
        {
            blockers.push({ resourceId: resource.id, reason: 'texture-style-not-analyzed' });
        }
        if (resource.excludedFields?.length && !(resource.records ?? []).every(item => item.sourceEvidence))
        {
            blockers.push({ resourceId: resource.id, reason: 'excluded-source-fields', fields: resource.excludedFields });
        }
    }
    if (!visual?.sourceComponentInventory?.length)
    {
        blockers.push({ reason: 'source-component-inventory-missing' });
    }
    const observedNodes = new Set((visual?.sourceComponentInventory ?? []).map(item => item.nodeId));
    for (const node of hierarchy)
    {
        if (!observedNodes.has(node.id))
        {
            blockers.push({ nodeId: node.id, reason: 'node-component-inventory-missing' });
        }
    }
    for (const component of visual?.sourceComponentInventory ?? [])
    {
        const principle = visual?.componentPrinciples?.[component.principleRef];
        const principleComplete = component.status === 'principle-only' && principle?.guid === component.scriptGuid
            && analyzed(principle, principle?.sourceHash, ['name', 'principle', 'inputs', 'visualImpact', 'reconstruction', 'method']);
        if (((component.status !== 'captured' || component.requiresPrinciple) && !principleComplete) || (component.excludedFields?.length && !component.sourceEvidence))
        {
            blockers.push({ nodeId: component.nodeId, componentId: component.componentId, reason: component.status === 'captured' ? 'excluded-component-fields' : component.status });
        }
    }
    return { schemaVersion: 'ui-source-features/1', hierarchy, bindings: visual?.bindings ?? [], componentPrinciples: visual?.componentPrinciples ?? {}, replacements: resources.filter(resource => resource.replacement).map(resource => ({ id: resource.id, ...resource.replacement })), componentCount: visual?.sourceComponentInventory?.length ?? 0, ...groups, extractionComplete: blockers.length === 0, blockers };
}
