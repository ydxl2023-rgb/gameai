import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

test('assembly preserves accepted whitebox bytes and rejects changed inputs',async()=>
{
    const root=await mkdtemp(join(tmpdir(),'gameai-snapshot-'));
    process.env.GAMEAI_PROJECT_ROOT=root;
    const {snapshotPrefabInputs}=await import('../src/database/delivery-snapshot.js');
    const {verifyTaskFiles}=await import('../src/database/task-files.js');
    try
    {
        await mkdir(join(root,'Assets'),{recursive:true});
        await writeFile(join(root,'Assets/UILogin.prefab'),'whitebox');
        const artifacts=[{path:'Assets/UILogin.prefab',sha256:createHash('sha256').update('whitebox').digest('hex')}];
        let saved;
        const c={query:async(sql,args)=>
        {
            if (sql.startsWith('UPDATE')) {saved=JSON.parse(args[1]); return {};}
            return {rows:[{task_key:'F-1',id:'execution-1',result:{artifacts}}]};
        }};
        await snapshotPrefabInputs(c,{id:'assembly',role_code:'Prefab',delivery_phase:'assembly'});
        assert.equal(saved[0].source_path,'Assets/UILogin.prefab');
        assert.equal(await readFile(join(root,saved[0].path),'utf8'),'whitebox');
        await writeFile(join(root,'Assets/UILogin.prefab'),'assembled');
        assert.equal(await verifyTaskFiles(saved),true);
        assert.equal(await verifyTaskFiles(artifacts),false);
        await assert.rejects(snapshotPrefabInputs(c,{id:'assembly',role_code:'Prefab',delivery_phase:'assembly'}),/白模交付已改变/);
        await snapshotPrefabInputs({query:()=>{throw Error('unexpected query');}},{role_code:'Art'});
    }
    finally {await rm(root,{recursive:true,force:true});}
});
