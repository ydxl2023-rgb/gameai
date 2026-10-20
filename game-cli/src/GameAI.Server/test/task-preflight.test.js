import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {embedUiTemplateContext} from '../src/database/ui-template-context.js';
import {preflightUiDocument} from '../src/track/task-preflight.js';

test('preflight preserves each probe, requires actual runtime success and redacts secrets',async()=>
{
    const directory=await mkdtemp(join(tmpdir(),'gameai-preflight-'));
    try
    {
        const hash=s=>createHash('sha256').update(s).digest('hex');
        const assembly={baselineJson:'{}',snapshotJson:'{}',approvalJson:'{}',sourceSha256:hash('{}'),snapshotSha256:hash('{}'),approvalSha256:hash('{}'),outputPrefab:'Assets/UICheck.prefab'};
        const html=embedUiTemplateContext('<html><body>fixture</body></html>',{targetAssembly:assembly});
        let calls=0;
        const guard=async(args,command,options)=>
        {
            calls++;
            assert.deepEqual(command,['ui-library','guard']);
            assert.equal(options.timeoutMs,30000);
            await writeFile(args[args.indexOf('--output')+1],JSON.stringify(assembly));
            return {code:0};
        };
        const unity=async args=>
        {
            assert.ok(args.includes('--dry-run'));
            assert.ok(args.includes('--whitebox'));
            return {code:0,output:JSON.stringify({ok:true,data:{token:'test-sensitive-token'}})};
        };
        const first=await preflightUiDocument(html,directory,guard,unity);
        const second=await preflightUiDocument(html,directory,guard,unity);
        assert.notEqual(first.evidenceDirectory,second.evidenceDirectory);
        assert.equal(first.runtimeValidated,true);
        assert.ok(!(await readFile(join(first.evidenceDirectory,'unity-dry-run.json'),'utf8')).includes('test-sensitive-token'));
        const tampered=embedUiTemplateContext('<html><body>fixture</body></html>',{targetAssembly:{...assembly,snapshotJson:'{"changed":true}'}});
        await assert.rejects(preflightUiDocument(tampered,directory,guard,unity),/哈希/);
        assert.equal(calls,2,'tampered payload rejected before invoking either tool');
    }
    finally
    {
        await rm(directory,{recursive:true,force:true});
    }
});
