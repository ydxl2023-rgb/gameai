import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryDecision} from '../src/database/task-recovery.js';

const base={state:'failed',error:'专业交付检查未通过。',attempts:1,authorized:true};
test('repairable delivery failure can resume only within the execution budget',()=>
{
    assert.equal(recoveryDecision(base).retry,true);
    assert.equal(recoveryDecision({...base,attempts:3}).retry,false);
    assert.equal(recoveryDecision({...base,authorized:false}).retry,false);
});
test('unknown process, approval and upstream failures never auto retry',()=>
{
    for(const error of ['执行阻塞：需要真机验收','需求版本或交付文件已失效','执行期间上游状态或产物改变','权限不足','unrecognized failure'])
    {
        assert.equal(recoveryDecision({...base,error}).retry,false,error);
    }
    assert.equal(recoveryDecision({...base,state:'unknown'}).retry,false);
});
test('confirmed stopped process may retry and identifies next attempt',()=>
{
    const result=recoveryDecision({...base,error:'任务进程未正常结束，请核实。',attempts:2});
    assert.equal(result.retry,true);
    assert.match(result.reason,/3\/3/);
});
