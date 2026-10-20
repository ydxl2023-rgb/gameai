import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryDecision,recoveryAttempts} from '../src/database/task-recovery.js';

const base={state:'failed',error:'专业交付检查未通过。',attempts:1,authorized:true};
test('verified host repair grants a finite new budget without deleting prior attempts',()=>
{
    const context={verified_repair_budget:{validated:true,prior_attempts:3,max_attempts:3,handlerFingerprint:'a'.repeat(64)}};
    assert.equal(recoveryAttempts(3,context),0);
    assert.equal(recoveryAttempts(4,context),1);
    assert.equal(recoveryAttempts(6,context),3);
    assert.equal(recoveryAttempts(4,{verified_repair_budget:{...context.verified_repair_budget,validated:false}}),4);
    assert.equal(recoveryAttempts(4,{verified_repair_budget:{...context.verified_repair_budget,handlerFingerprint:'unverified'}}),4);
});
test('explicit external waits never become technical repair retries',()=>
{
    for (const [prefix,code] of [['WAIT_DEVICE','awaiting_device'],['WAIT_APPROVAL','awaiting_decision'],['WAIT_DEPENDENCY','awaiting_dependency'],['TOOL_UNAVAILABLE','awaiting_environment']])
    {
        const result=recoveryDecision({...base,error:prefix+': 连接超时，专业交付检查未通过'});
        assert.equal(result.retry,false);
        assert.equal(result.code,code);
    }
});
test('human repair cycle retains history but grants only three executions',()=>
{
    const context={recovery_cycle:{prior_attempts:7}};
    assert.equal(recoveryAttempts(8,context),1);
    assert.equal(recoveryDecision({...base,attempts:recoveryAttempts(9,context)}).retry,true);
    assert.equal(recoveryDecision({...base,attempts:recoveryAttempts(10,context)}).retry,false);
    assert.equal(recoveryAttempts(10,{}),10);
    assert.equal(recoveryAttempts(10,{recovery_cycle:{prior_attempts:11}}),10);
    assert.equal(recoveryAttempts(10,{recovery_cycle:{prior_attempts:-1}}),10);
});
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

test('technical blocked reports do not confuse preserved approval with human approval',()=>
{
    const error='执行阻塞：需宿主提供保持批准布局不变的预览视域与深度适配：适龄面板局部Z=-600，当前截图仅见遮罩；R18超出预览视域。';
    assert.equal(recoveryDecision({...base,error}).retry,true);
    assert.equal(recoveryDecision({...base,error,authorized:false}).retry,false);
    assert.equal(recoveryDecision({...base,error,state:'unknown'}).retry,false);
    assert.equal(recoveryDecision({...base,error,attempts:3}).retry,false);
    for (const gate of ['权限不足','需要人工批准修改布局','上游交付已改变','输入哈希不匹配'])
    {
        assert.equal(recoveryDecision({...base,error:error+gate}).retry,false);
    }
});
test('confirmed timeout can retry despite descriptive stop-proof wording',()=>
{
    const error='任务执行超时，需核实停止凭据；确认停止后复用已有产物及检查证据继续。';
    assert.equal(recoveryDecision({...base,error}).retry,true);
    assert.equal(recoveryDecision({...base,error,state:'unknown'}).retry,false);
});

test('simulated input failures allow bounded original-agent diagnosis without bypassing gates',()=>
{
    const error='执行阻塞：tips嵌套Canvas没有GraphicRaycaster，closeTips在当前原生UGUI验证宿主下未命中。需宿主明确允许的输入适配或批准结构修订；四个右侧命中区域越过右边界。';
    assert.equal(recoveryDecision({...base,error}).retry,true);
    for (const change of [{authorized:false},{state:'unknown'},{attempts:3}])
    {
        assert.equal(recoveryDecision({...base,error,...change}).retry,false);
    }
    for (const gate of ['WAIT_APPROVAL','需要人工批准修改布局','上游交付已改变','输入哈希不匹配'])
    {
        assert.equal(recoveryDecision({...base,error:gate+'；'+error}).retry,false);
    }
    assert.equal(recoveryDecision({...base,error:'四个右侧命中区域超出模拟安全区'}).retry,true);
    assert.equal(recoveryDecision({...base,error:'需要批准变更冻结契约，closeTips未命中'}).retry,false);
});
