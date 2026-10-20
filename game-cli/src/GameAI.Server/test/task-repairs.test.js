import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseRepair,repairIdentity} from '../src/database/task-repairs.js';

const row={execution_state:'failed',attempts:1,authorized:true,error:'unknown fault'};
test('unknown faults get bounded original-role diagnosis, while real gates stay closed',()=>
{
    assert.equal(diagnoseRepair(row).code,'diagnostic_repair');
    for (const patch of [{authorized:false},{execution_state:'unknown'},{attempts:3},{error:'WAIT_APPROVAL: requires a new target'},{error:'输入哈希不匹配'}])
    {
        assert.equal(diagnoseRepair({...row,...patch}).action,'attention');
    }
    assert.equal(diagnoseRepair({...row,error:'上游已改变'}).action,'dependency');
    assert.equal(diagnoseRepair({...row,error:'WAIT_APPROVAL: 装配参数需要新的业务决定',failure:{code:'CONTRACT_CONFLICT'}}).action,'attention');
});
test('contract defects route to host verification, not blind original-role retries',()=>
{
    assert.equal(diagnoseRepair({...row,error:'CONTRACT_CONFLICT: two no-op entries'}).action,'guard');
    assert.equal(diagnoseRepair({...row,failure:{code:'PLATFORM_GUARD_INVALID'}}).action,'guard');
    assert.equal(diagnoseRepair({...row,failure:{code:'UNITY_UNAVAILABLE'}}).action,'environment');
});
test('new report files do not disguise repeated failures as production progress',()=>
{
    const identity=files=>repairIdentity('error',null,{input_hash:'fixed'},{Text:JSON.stringify({checks:[{name:'guard',passed:false}]}),artifacts:files});
    assert.deepEqual(identity([{path:'deliveries/report1.json',sha256:'a'}]),identity([{path:'deliveries/report2.json',sha256:'b'}]));
    assert.notEqual(identity([{path:'app/client/Assets/UI.prefab',sha256:'a'}]).progress_hash,identity([{path:'app/client/Assets/UI.prefab',sha256:'b'}]).progress_hash);
});
test('structured root causes retain their identity when the model rephrases checks and steps',()=>
{
    const first=repairIdentity('first report',{code:'UPSTREAM_INVALID',items:[{step:'first wording'}]},{repair_input_hash:'fixed'},{Text:JSON.stringify({checks:[{name:'first check',passed:false}]})});
    const second=repairIdentity('different report',{code:'UPSTREAM_INVALID',items:[{step:'different wording'}]},{repair_input_hash:'fixed'},{Text:JSON.stringify({checks:[{name:'different check',passed:false}]})});
    assert.equal(first.fingerprint,second.fingerprint);
});
