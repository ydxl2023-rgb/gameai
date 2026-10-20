import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../src/database/ui-production-contract.js';
import {readRequirementRules} from '../src/database/requirement-rules.js';
import {taskDisplayState} from '../src/database/task-display-state.js';

test('durable repair status is visible without overriding real process or completion state',()=>
{
    for (const [state,label] of [['pending','自动诊断'],['diagnosing','自动诊断'],['ready','准备恢复'],['attention','待处理']])
    {
        assert.equal(taskDisplayState({status:'failed',recovery_detail:{state}}),label);
        assert.equal(taskDisplayState({status:'completed',recovery_detail:{state}}),'已完成');
        assert.equal(taskDisplayState({status:'running',execution_state:'unknown',recovery_detail:{state}}),'待核实');
    }
});

test('frozen rules are read without consulting mutable skills; missing or corrupt snapshots fail closed',async()=>
{
    const content={roles:{PM:'approved instructions'},projectSkills:[]};
    const sha256=digest(content);
    const db=(snapshot,hash)=>({query:async sql=>({rows:sql.includes('requirement_rule_snapshots')?(snapshot?[snapshot]:[]):[{hash}]})});
    assert.equal((await readRequirementRules(db({content,sha256},sha256),'version','PM')).instructions,'approved instructions');
    assert.equal(await readRequirementRules(db(null,null),'legacy','PM'),null);
    await assert.rejects(readRequirementRules(db(null,sha256),'version','PM'),/缺失/);
    await assert.rejects(readRequirementRules(db({content:{...content,roles:{PM:'changed'}},sha256},sha256),'version','PM'),/绑定失效/);
    await assert.rejects(readRequirementRules(db({content,sha256},sha256),'version','Art'),/缺少角色/);
});

test('external waits are distinct from failure and never replace later review or completion',()=>
{
    for (const [code,label] of Object.entries({awaiting_device:'等待设备',awaiting_decision:'等待审批',awaiting_dependency:'等待上游',awaiting_environment:'等待工具',awaiting_authorization:'等待授权'}))
    {
        assert.equal(taskDisplayState({status:'failed',recovery:{code}}),label);
        assert.equal(taskDisplayState({status:'review',recovery:{code}}),'待验收');
        assert.equal(taskDisplayState({status:'completed',recovery:{code}}),'已完成');
    }
    assert.equal(taskDisplayState({status:'failed',recovery:{code:'retry_exhausted'}}),'失败');
    assert.equal(taskDisplayState({status:'failed',execution_state:'unknown',recovery:{code:'awaiting_device'}}),'待核实');
});
