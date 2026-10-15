// Raw parameter evidence remains in PostgreSQL. Embeddings contain all semantic feature sections,
// without repeating source GUIDs and serialized property names for every node.
export function searchText(name, assetPath, summary)
{
    const source = summary.sourceFeatures;
    if (!source)
    {
        return `${name}\n${assetPath}\n${JSON.stringify(summary)}`;
    }
    const nodes = new Map(source.hierarchy.map(node => [node.id, node]));
    const location = node =>
    {
        const parts = [node.name];
        let parent = nodes.get(node.parentId);
        const seen = new Set([node.id]);
        while (parent && !seen.has(parent.id))
        {
            seen.add(parent.id);
            parts.unshift(parent.name);
            parent = nodes.get(parent.parentId);
        }
        return parts.join('/');
    };
    const lines = [name, assetPath, `category=${summary.category}; extractionComplete=${source.extractionComplete}`];
    for (const node of source.hierarchy)
    {
        lines.push(`layout ${location(node)}; ${JSON.stringify(node.rect)}; ${node.components.map(component => component.type).join(',')}`);
    }
    for (const group of ['animations', 'controllers', 'animationBindings', 'effects', 'materials', 'shaders', 'textures'])
    {
        for (const item of source[group] ?? [])
        {
            lines.push(`${group} ${item.path ?? item.id}; ${JSON.stringify(item.implementation ?? item.features)}`);
        }
    }
    for (const item of Object.values(source.componentPrinciples ?? {}))
    {
        lines.push(`component ${item.name}; ${item.principle}; inputs=${item.inputs}; visual=${item.visualImpact}; rebuild=${item.reconstruction}`);
    }
    lines.push(`replacements ${JSON.stringify(source.replacements ?? [])}`);
    lines.push(`blockers ${JSON.stringify(source.blockers)}`);
    return lines.join('\n');
}
