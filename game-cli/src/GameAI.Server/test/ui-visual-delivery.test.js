import test from 'node:test';
import assert from 'node:assert/strict';
import {requiredAnimationFiles,validateVisualDelivery} from '../src/database/ui-visual-delivery.js';

const window={animations:[{id:'arbitrary-motion',specification:{controllerPath:'Assets/Other/Move.controller',commands:[['animator','clip','create','--clip','Assets/Other/Move.anim']]}}]};
test('dynamic asset coverage is independent of window names and rejects partial delivery',()=>{
    const input={type:'art-resources',window};
    assert.throws(()=>validateVisualDelivery(input,[{path:'report.json'}]),/未完整交付/);
    const files=requiredAnimationFiles(window).map(path=>({path}));
    assert.doesNotThrow(()=>validateVisualDelivery(input,files));
    assert.throws(()=>validateVisualDelivery(input,files.slice(1)),/未完整交付/);
    assert.doesNotThrow(()=>validateVisualDelivery({type:'prefab-whitebox',window},[]));
});
test('unknown animation formats and unsafe paths fail closed',()=>{
    assert.throws(()=>requiredAnimationFiles({animations:[{id:'unknown',specification:{}}]}),/unsupported/);
    assert.throws(()=>requiredAnimationFiles({animations:[{specification:{controllerPath:'Assets/../Move.controller'}}]}),/Invalid/);
});
