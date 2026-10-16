import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ui-production-fixture.js';
import {prepareDesignDocument,sealDesignReview,validateDesignDocument,buildProductionSkeleton} from '../src/database/design-contract.js';
function prepared()
{
    const {contract}=fixture();
    return prepareDesignDocument({html:'<!doctype html><html><body><section id="W01"><h1>登录窗口</h1><p>完整需求</p></section></body></html>',spec:{...contract,schemaVersion:'ui-design-spec/1'}});
}
test('compile, review, bind identity and derive exactly three tasks',()=>
{
    const p=prepared();
    const final=sealDesignReview({html:p.html,review:{passed:true,issues:[],summary:'Checked against requirement',documentHash:p.documentHash,contractHash:p.contractHash,executionId:'review-run',threadId:'review-thread'}}).html;
    assert.equal(validateDesignDocument(final,{projectId:p.contract.projectId,versionId:p.contract.requirementVersionId,executionId:'review-run'}).contract.id,p.contract.id);
    assert.deepEqual(buildProductionSkeleton(final,'v1').tasks.map(t=>t.phase),['whitebox','art','assembly']);
    assert.throws(()=>validateDesignDocument(final.replace('完整需求','改动需求')),/changed/);
    assert.throws(()=>validateDesignDocument(final,{projectId:crypto.randomUUID()}),/project/);
    assert.throws(()=>validateDesignDocument(final,{executionId:'other'}),/execution/);
});
test('missing review, failed review, stale review and missing section fail closed',()=>
{
    const p=prepared();
    assert.throws(()=>validateDesignDocument(p.html),/self-review/);
    assert.throws(()=>sealDesignReview({html:p.html,review:{passed:false}}));
    assert.throws(()=>sealDesignReview({html:p.html,review:{passed:true,issues:[],summary:'ok',documentHash:'a'.repeat(64),contractHash:p.contractHash,executionId:'r',threadId:'t'}}),/match/);
    const {contract}=fixture();
    assert.throws(()=>prepareDesignDocument({html:'<html><body>no section</body></html>',spec:{...contract,schemaVersion:'ui-design-spec/1'}}),/visible section/);
    assert.throws(()=>prepareDesignDocument({html:p.html,spec:{...contract,schemaVersion:'ui-design-spec/1'}}),/Duplicate/);
});
