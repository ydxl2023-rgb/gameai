import {readFile,access} from 'node:fs/promises';
import {join,posix} from 'node:path';
import {createHash} from 'node:crypto';

export async function loadAssetAliases(project)
{
    let value;
    try { value=JSON.parse(await readFile(join(project,'app/client/ProjectSettings/UnityCliAssetAliases.json'),'utf8')); }
    catch(error) { if(error.code==='ENOENT') return []; throw error; }
    if(value.schemaVersion!=='unity-asset-path-aliases/1' || !Array.isArray(value.assets)) throw new Error('Invalid asset path migration registry');
    const seen=new Set();
    for(const entry of value.assets)
    {
        if(!/^Assets\/UI\/(?:[A-Za-z0-9_-]+\/)+[a-f0-9]{64}\.(?:png|ttf|otf|ttc)$/.test(entry.from) ||
            !/^Assets\/UI\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z][A-Za-z0-9_]{0,63}\.(?:png|ttf|otf|ttc)$/.test(entry.to) ||
            posix.extname(entry.from)!==posix.extname(entry.to) || posix.dirname(entry.from)!==posix.dirname(entry.to) || !/^[a-f0-9]{32}$/.test(entry.guid) ||
            !/^[a-f0-9]{64}$/.test(entry.sha256) || !/^[a-f0-9]{64}$/.test(entry.metaSha256) || seen.has(entry.from) || seen.has(entry.to)) throw new Error('Invalid or duplicate asset path alias');
        seen.add(entry.from);seen.add(entry.to);
    }
    return value.assets;
}

export async function resolveAssetAlias(project,path,entries)
{
    const meta=path.endsWith('.meta');
    const asset=meta ? path.slice(0,-5) : path;
    const entry=entries.find(e=>'app/client/'+e.from===asset);
    if(!entry) return path;
    try { await access(join(project,'app/client',entry.from)); throw new Error('Legacy asset was recreated after migration: '+entry.from); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    const target=join(project,'app/client',entry.to);
    const bytes=await readFile(target);
    const metadata=await readFile(target+'.meta');
    if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256 ||
        createHash('sha256').update(metadata).digest('hex')!==entry.metaSha256 ||
        !new RegExp('^guid: '+entry.guid+'\\r?$','m').test(metadata.toString('utf8'))) throw new Error('Migrated asset identity mismatch: '+entry.to);
    return 'app/client/'+entry.to+(meta ? '.meta' : '');
}
