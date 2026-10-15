import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis } from '../src/ui-library/analysis.js';
import { visualFeatures } from '../src/ui-library/features.js';
import { searchText } from '../src/asset-library/search-text.js';

test('analysis is pinned to source bytes and cannot approve runtime equivalence', () =>
{
    const item = { sourceHash: 'a'.repeat(64), method: 'source review', principle: 'Mesh expansion and alpha sampling' };
    assert.throws(() => validateAnalysis(item, 'b'.repeat(64), ['principle']), /hash/);
    assert.throws(() => validateAnalysis({ ...item, principle: '' }, item.sourceHash, ['principle']), /Missing/);
    assert.equal(validateAnalysis(item, item.sourceHash, ['principle']).runtimeVerified, false);
});

test('a completed flag alone cannot bypass mandatory shader and style analysis', () =>
{
    const result = visualFeatures([
        { id: 't', kind: 'texture', sourceHash: 'a'.repeat(64), textureFeatures: { pixelAnalysisStatus: 'complete', styleAnalysisStatus: 'complete' } },
        { id: 's', kind: 'shader-description', sourceHash: 'b'.repeat(64), status: 'implementation-analyzed', implementation: { status: 'analyzed' } },
    ]);
    assert.ok(result.blockers.some(item => item.reason === 'texture-style-not-analyzed'));
    assert.ok(result.blockers.some(item => item.reason === 'shader-implementation-not-analyzed'));
});

test('semantic search includes every node and the reviewed reconstruction principles', () =>
{
    const hierarchy = Array.from({ length: 132 }, (_, index) => ({ id: String(index), parentId: null, name: `Node${index}`, rect: null, components: [] }));
    const text = searchText('Login', 'source', { sourceFeatures: { hierarchy, blockers: [], textures: [{ path: 'button', features: { style: { family: 'sports anime' } } }], shaders: [{ path: 'outline', implementation: { algorithm: '12 direction sampling' } }], componentPrinciples: { g: { name: 'Scale', principle: 'OutSine' } } } });
    assert.ok(text.includes('Node131'));
    assert.ok(text.includes('sports anime'));
    assert.ok(text.includes('12 direction sampling'));
    assert.ok(text.includes('OutSine'));
});

test('an existing native projection never exempts custom behavior from principle review', () =>
{
    const result = visualFeatures([], { sourceComponentInventory: [{ nodeId: 'r', componentId: 'c', status: 'captured', requiresPrinciple: true }], bindings: [] }, { prefab: { nodes: [{ id: 'r', components: [] }] } });
    assert.equal(result.extractionComplete, false);
    assert.ok(result.blockers.some(item => item.componentId === 'c'));
});
