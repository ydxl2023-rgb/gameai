import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerContractAssets} from '../src/database/delivery-registration.js';
import {recoveryDecision} from '../src/database/task-recovery.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const input={type:'art-resources',window:{animations:[{id:'motion',specification:{controllerPath:'Assets/Shop/Unexpected.controller',commands:[['clip','--clip','Assets/Shop/Glow.anim']]}}]}};
const paths=['app/client/Assets/Shop/Unexpected.controller','app/client/Assets/Shop/Glow.anim'];
const entries=paths.map(path=>({path,sha256:hash(path)}));
function fixture(records=entries)
{
    const bytes=Buffer.from(JSON.stringify(records));
    return {artifacts:[{path:'deliveries/any/receipt.json',sha256:hash(bytes)}],options:{read:async()=>bytes,inspect:async files=>files.map(path=>({path,sha256:hash(path)}))}};
}
test('registers only frozen assets from verified current receipts, idempotently',async()=>{
    const f=fixture([...entries,{path:'unrelated.anim',sha256:hash('old')}]);
    const result=await registerContractAssets(input,f.artifacts,f.options);
    assert.deepEqual(result.slice(1).map(a=>a.path).sort(),paths.sort());
    assert.deepEqual(await registerContractAssets(input,result,f.options),result);
});
test('existing files or ZIP without receipts never imply delivery',async()=>{
    const f=fixture([]);
    await assert.rejects(registerContractAssets(input,f.artifacts,f.options),{code:'DELIVERY_REGISTRATION_MISSING'});
});
test('missing, changed and contradictory assets fail with distinct codes',async()=>{
    const f=fixture();
    await assert.rejects(registerContractAssets(input,f.artifacts,{...f.options,inspect:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}}),{code:'DELIVERY_FILE_MISSING'});
    await assert.rejects(registerContractAssets(input,f.artifacts,{...f.options,inspect:async files=>files.map(path=>({path,sha256:hash('changed')}))}),{code:'DELIVERY_HASH_MISMATCH'});
    const conflict=fixture([...entries,{...entries[0],sha256:hash('different')}]);
    await assert.rejects(registerContractAssets(input,conflict.artifacts,conflict.options),{code:'DELIVERY_RECEIPT_CONFLICT'});
    await assert.rejects(registerContractAssets(input,f.artifacts,{...f.options,read:async()=>Buffer.from('[]')}),{code:'DELIVERY_HASH_MISMATCH'});
});
test('whitebox is excluded; assembly accepts already registered upstream assets',async()=>{
    assert.deepEqual(await registerContractAssets({...input,type:'prefab-whitebox'},[]),[]);
    assert.deepEqual(await registerContractAssets({...input,type:'prefab-assembly'},entries),entries);
});
test('typed recovery is independent of localized wording and retains gates',()=>{
    const base={state:'failed',error:'任意语言说明',failure:{code:'DELIVERY_REGISTRATION_MISSING',items:paths},attempts:1,authorized:true};
    assert.equal(recoveryDecision(base).retry,true);
    for(const change of [{authorized:false},{attempts:3},{state:'unknown'},{error:'WAIT_APPROVAL'},{failure:{code:'UNSUPPORTED'}}])
    {
        assert.equal(recoveryDecision({...base,...change}).retry,false);
    }
});
