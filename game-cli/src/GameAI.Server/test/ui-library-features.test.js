import test from 'node:test';
import assert from 'node:assert/strict';
import { visualFeatures } from '../src/ui-library/features.js';
import { featureChunks } from '../src/asset-library/index.js';

const document = { prefab: { nodes: [{ id: 'root', parentId: null, name: 'Root', rect: {}, components: [] }] } };
const visual = { sourceComponentInventory: [{ nodeId: 'root', componentId: 't', status: 'captured' }], bindings: [] };

test('long feature documents preserve every character across embedding chunks', () =>
{
    const text = '登录🎮动画材质'.repeat(4000);
    const chunks = featureChunks(text);
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every(chunk => Array.from(chunk).length <= 1800));
});

test('old exports cannot silently become complete', () =>
{
    assert.equal(visualFeatures().extractionComplete, false);
});

test('pixel analysis cannot substitute for style or shader analysis', () =>
{
    const result = visualFeatures([
        { id: 't', kind: 'texture', textureFeatures: { pixelAnalysisStatus: 'complete' } },
        { id: 's', kind: 'shader-description', status: 'analysis-required' },
    ], visual, document);
    assert.equal(result.extractionComplete, false);
    assert.ok(result.blockers.some(item => item.reason === 'texture-style-not-analyzed'));
    assert.ok(result.blockers.some(item => item.reason === 'analysis-required'));
});

test('native source callback evidence remains separate from executable fields', () =>
{
    const evidence = structuredClone(visual);
    evidence.sourceComponentInventory[0].excludedFields = [{ path: '/m_Events' }];
    assert.equal(visualFeatures([], evidence, document).extractionComplete, false);
    evidence.sourceComponentInventory[0].sourceEvidence = { m_Events: [{ functionName: 'OnFinished' }] };
    assert.equal(visualFeatures([], evidence, document).extractionComplete, true);
});

test('hierarchy is never limited to the first forty nodes', () =>
{
    const input = { prefab: { nodes: Array.from({ length: 132 }, (_, id) => ({ id: String(id), components: [] })) } };
    assert.equal(visualFeatures([], visual, input).hierarchy.length, 132);
});
