import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {resourceNamingPlan} from '../src/database/ui-asset-naming.js';
import {loadAssetAliases,resolveAssetAlias} from '../src/database/asset-path-aliases.js';

test('names describe binding use, retain source hashes and disambiguate deterministically',()=>
{
    const sourceReference={artifactId:'source',sha256:'a'.repeat(64)};
    const window={nodes:[{id:'button',name:'repairButton',parentId:null},{id:'icon',name:'icon',parentId:'button'}],resourceSlots:['second','first'].map(slotId=>({slotId,kind:'sprite',sourceReference,bindings:[{nodeId:'icon'}]}))};
    const plan=resourceNamingPlan(window);
    assert.equal(plan[0].recommendedName,'RepairIcon');
    assert.match(plan[1].recommendedName,/^RepairIcon_[a-f0-9]{8}$/);
    assert.equal(plan[0].sourceReference.sha256,sourceReference.sha256);
    assert.deepEqual(plan,resourceNamingPlan({...window,resourceSlots:[...window.resourceSlots].reverse()}));
    const font={...window,resourceSlots:[{...window.resourceSlots[0],kind:'font'}]};
    assert.equal(resourceNamingPlan(font)[0].recommendedName,null,'unknown font families must not be invented from control names');
    assert.equal(resourceNamingPlan(font,[{sha256:sourceReference.sha256,to:'Assets/UI/Test/MicrosoftYaHeiRegular.ttc'}])[0].recommendedName,'MicrosoftYaHeiRegular');
});

test('historical paths resolve only to the same registered PNG bytes, metadata and GUID',async()=>
{
    const project=await mkdtemp(join(tmpdir(),'asset-alias-'));
    try
    {
        const sha=value=>createHash('sha256').update(value).digest('hex');
        const bytes=Buffer.from('test PNG identity');
        const metadata='guid: '+'b'.repeat(32)+'\n';
        const entry={from:'Assets/UI/Test/Art/'+sha(bytes)+'.png',to:'Assets/UI/Test/Art/RepairIcon.png',guid:'b'.repeat(32),sha256:sha(bytes),metaSha256:sha(metadata)};
        await mkdir(join(project,'app/client/ProjectSettings'),{recursive:true});
        await mkdir(join(project,'app/client/Assets/UI/Test/Art'),{recursive:true});
        await writeFile(join(project,'app/client',entry.to),bytes);
        await writeFile(join(project,'app/client',entry.to+'.meta'),metadata);
        const registry=join(project,'app/client/ProjectSettings/UnityCliAssetAliases.json');
        await writeFile(registry,JSON.stringify({schemaVersion:'unity-asset-path-aliases/1',assets:[entry]}));
        const aliases=await loadAssetAliases(project);
        assert.equal(await resolveAssetAlias(project,'app/client/'+entry.from,aliases),'app/client/'+entry.to);
        assert.equal(await resolveAssetAlias(project,'app/client/'+entry.from+'.meta',aliases),'app/client/'+entry.to+'.meta');
        await writeFile(join(project,'app/client',entry.to),'changed');
        await assert.rejects(resolveAssetAlias(project,'app/client/'+entry.from,aliases),/identity/);
        await writeFile(join(project,'app/client',entry.to),bytes);
        await writeFile(join(project,'app/client',entry.from),bytes);
        await assert.rejects(resolveAssetAlias(project,'app/client/'+entry.from,aliases),/recreated/);
        await writeFile(registry,JSON.stringify({schemaVersion:'unity-asset-path-aliases/1',assets:[{...entry,to:'../secret.png'}]}));
        await assert.rejects(loadAssetAliases(project),/Invalid/);
        for(const extension of ['ttf','otf','ttc'])
        {
            const font={...entry,from:entry.from.replace('.png','.'+extension),to:entry.to.replace('RepairIcon.png','MicrosoftYaHeiRegular.'+extension)};
            await writeFile(join(project,'app/client',font.to),bytes);
            await writeFile(join(project,'app/client',font.to+'.meta'),metadata);
            await writeFile(registry,JSON.stringify({schemaVersion:'unity-asset-path-aliases/1',assets:[font]}));
            assert.equal(await resolveAssetAlias(project,'app/client/'+font.from,await loadAssetAliases(project)),'app/client/'+font.to);
            await writeFile(registry,JSON.stringify({schemaVersion:'unity-asset-path-aliases/1',assets:[{...font,to:entry.to}]}));
            await assert.rejects(loadAssetAliases(project),/Invalid/,'renaming must not change the font format');
        }
    }
    finally
    {
        assert.ok(resolve(project).startsWith(resolve(tmpdir())+sep+'asset-alias-'));
        await rm(project,{recursive:true,force:true});
    }
});
