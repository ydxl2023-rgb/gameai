import {createHash} from 'node:crypto';

function title(value)
{
    return value.replace(/[^A-Za-z0-9]+/g,' ').split(/\s+/).filter(Boolean).map(word=>word[0].toUpperCase()+word.slice(1)).join('');
}

// Names describe use. Full hashes and source identities stay in the manifest.
export function resourceNamingPlan(window,aliases=[])
{
    if(!window) return [];
    const nodes=new Map(window.nodes.map(node=>[node.id,node]));
    const used=new Set();
    return [...window.resourceSlots].sort((a,b)=>a.slotId.localeCompare(b.slotId)).map(slot=>
    {
        const node=nodes.get(slot.bindings[0]?.nodeId);
        const parent=nodes.get(node?.parentId);
        const migrated=aliases.find(entry=>entry.sha256===slot.sourceReference?.sha256);
        let name=slot.kind==='font' ? 'UiFont' : node?.name ?? slot.slotId;
        if(migrated)
        {
            name=migrated.to.split('/').at(-1).replace(/\.[^.]+$/,'');
        }
        if(/^(icon|red|image|background|bg)$/i.test(name) && parent)
        {
            name=parent.name.replace(/Button$/,'')+(name==='red' ? 'NotificationDot' : title(name));
        }
        name=title(name).slice(0,40) || 'Resource';
        if(!/^[A-Za-z]/.test(name)) name='Resource'+name;
        const key=name.toLowerCase();
        if(used.has(key))
        {
            name+='_'+createHash('sha256').update(slot.slotId).digest('hex').slice(0,8);
        }
        used.add(name.toLowerCase());
        return {slotId:slot.slotId,recommendedName:slot.kind==='font' && !migrated ? null : name,kind:slot.kind,
            namingHint:slot.kind==='font' ? 'Read font family and subfamily metadata; use FamilyRegular/FamilyBold and preserve the original extension.' : 'Use a short purpose name.',
            sourceReference:slot.sourceReference ?? null};
    });
}
