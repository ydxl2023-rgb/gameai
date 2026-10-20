import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTaskResult} from '../src/database/task-results.js';
import {deliveryFailure} from '../src/database/delivery-errors.js';

test('structured specialist failures preserve category, failing step and real evidence reference',()=>
{
    const value={verdict:'blocked',summary:'Unity disconnected',deliverables:[],files:['deliveries/issue.json'],questions:[],checks:[],failure:{code:'ENVIRONMENT_UNAVAILABLE',step:'Unity prefab validation',evidence_path:'deliveries/issue.json',repair:'Reconnect the existing bridge'}};
    try { validateTaskResult(value,'Art');assert.fail('must reject blocked result'); }
    catch(error)
    {
        const failure=deliveryFailure(error);
        assert.equal(failure.code,'ENVIRONMENT_UNAVAILABLE');
        assert.equal(failure.items[0].step,value.failure.step);
    }
    assert.throws(()=>validateTaskResult({...value,files:[]},'Art'),/证据/);
    assert.throws(()=>validateTaskResult({...value,verdict:'pass'},'Art'),/通过/);
});
