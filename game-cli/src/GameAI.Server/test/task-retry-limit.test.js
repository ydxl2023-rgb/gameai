import test from 'node:test';
import assert from 'node:assert/strict';
import {retryLimitReason} from '../src/database/task-dispatch.js';

test('ordinary retries retain the three-execution ceiling',()=>
{
    assert.equal(retryLimitReason(2,undefined,false),'');
    assert.notEqual(retryLimitReason(3,undefined,false),'');
});

test('manual exception authorizes only the observed next attempt',()=>
{
    const approval={attempts:3,reason:'Environment repaired; user requests retry'};
    assert.equal(retryLimitReason(3,approval,false),'');
    assert.notEqual(retryLimitReason(4,approval,false),'');
    assert.notEqual(retryLimitReason(3,approval,true),'');
});
