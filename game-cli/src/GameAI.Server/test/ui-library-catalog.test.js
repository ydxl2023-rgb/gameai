import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, score } from '../src/ui-library/catalog.js';

function row(name, nodes)
{
    return { name, asset_path: 'Assets/UI/' + name + '.prefab', document: { prefab: { rootNodeId: 'root', nodes } }, has_visual: true, visual_resources: [], diagnostics: [], grade: 'reference-only' };
}
function node(name, type, properties = {})
{
    return { id: name, name, parentId: null, rect: null, active: true, components: [{ type, properties }] };
}
test('dialog structure outranks an unrelated button and explains matches', () =>
{
    const dialog = summarize(row('TipsView', [node('CloseBtn', 'UnityEngine.UI.Button'), node('ConfirmButton', 'UnityEngine.UI.Button')]));
    const login = summarize(row('LoginView', [node('LoginButton', 'UnityEngine.UI.Button')]));
    assert.equal(dialog.category, 'dialog');
    assert.equal(score(dialog, '带确认和关闭按钮的提示窗口').score, 21);
    assert.equal(score(login, '带确认和关闭按钮的提示窗口').score, 0);
    assert.equal(score(dialog, '完全不存在的查询').score, 0);
});
test('scroll flags preserve serialized false values and do not advertise rebuild readiness', () =>
{
    const summary = summarize(row('Shop', [node('List', 'UnityEngine.UI.ScrollRect', { m_Horizontal: '0', m_Vertical: 1 })]));
    assert.deepEqual(summary.scrolls, [{ horizontal: false, vertical: true }]);
    assert.equal(summary.readiness, 'requires-restore-preflight');
    assert.ok(score(summary, '纵向商店列表').score > score(summary, '横向商店列表').score);
});
test('missing resources remain visible in candidate limitations', () =>
{
    const input = row('Reward', []);
    input.visual_resources = [{ status: 'unresolved' }, { status: 'source-evidence' }];
    const summary = summarize(input);
    assert.equal(summary.missingResourceCount, 1);
    assert.equal(summary.readiness, 'adaptation-required');
});
