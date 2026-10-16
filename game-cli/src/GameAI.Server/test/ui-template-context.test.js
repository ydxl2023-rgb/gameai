import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {embedUiTemplateContext,readUiTemplateContext,preserveUiTemplateContext,validateUiTemplateGuardContext} from '../src/database/ui-template-context.js';
import {buildPrefabTaskHtml} from '../src/database/prefab-task-document.js';

const html='<html><body><section id="window"><h2>Window</h2></section></body></html>';
const payload={sourceHierarchy:[{name:'hiddenNode',active:false}],targetSnapshot:{nodes:[1,2]},commands:['</script><script>bad</script>','$&']};
test('context is inert, hash checked and survives a model omitting it',()=>{
    const source=embedUiTemplateContext(html,payload);
    assert.deepEqual(readUiTemplateContext(source).payload,payload);
    assert.equal((source.match(/<script/g)||[]).length,1);
    assert.equal(preserveUiTemplateContext(source,html),source);
    assert.equal(preserveUiTemplateContext(source,source),source);
    assert.throws(()=>readUiTemplateContext(source.replace('hiddenNode','changed')),/hash mismatch/);
    assert.throws(()=>preserveUiTemplateContext(source,embedUiTemplateContext(html,{different:true})),/cannot change/);
});
test('task section extraction carries the complete external context',()=>{
    const source=embedUiTemplateContext(html,payload);
    const task=buildPrefabTaskHtml(source,{task_key:'F-1',title:'Window',source_refs:['#window']},createHash('sha256').update(source).digest('hex'));
    assert.deepEqual(readUiTemplateContext(task).payload,payload);
});
test('duplicates and malformed context fail closed; old documents remain supported',()=>{
    const source=embedUiTemplateContext(html,payload);
    assert.throws(()=>readUiTemplateContext(source+source),/duplicate/);
    assert.equal(readUiTemplateContext(html),null);
    assert.equal(preserveUiTemplateContext(html,html),html);
});

test('submission requires the exact adapted baseline paired with authorization',()=>{
    const baseline='{\n"schemaVersion":"ui-template/1","prefab":{"nodes":[]}}';
    const authorizedChanges={sourceSha256:createHash('sha256').update(baseline).digest('hex')};
    assert.throws(()=>validateUiTemplateGuardContext(embedUiTemplateContext(html,{sourceSnapshot:{},authorizedChanges})),/BASELINE_MISSING/);
    assert.doesNotThrow(()=>validateUiTemplateGuardContext(embedUiTemplateContext(html,{guardBaselineJson:baseline,authorizedChanges})));
    assert.throws(()=>validateUiTemplateGuardContext(embedUiTemplateContext(html,{guardBaselineJson:baseline.replace(/\n/g,'\r\n'),authorizedChanges})),/BASELINE_MISMATCH/);
});
