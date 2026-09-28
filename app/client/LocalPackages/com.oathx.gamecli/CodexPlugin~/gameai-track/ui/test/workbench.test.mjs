import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
const fixture = JSON.parse(await readFile(new URL('../../../../GameCLI~/GameCLIServer/src/track/workbench.json', import.meta.url), 'utf8'));
const snapshot = () => ({ schema_version: 2, mode: 'demo', server_time: new Date().toISOString(), request_id: 'ui-test', workbench: structuredClone(fixture) });
async function moduleBundle(name, context = {})
{
    const result = await build({ entryPoints: [fileURLToPath(new URL('../src/' + name + '.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' });
    const module = { exports: {} };
    runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, setTimeout, clearTimeout, console, ...context });
    return module.exports;
}
const delay = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check)
{
    for (let i = 0; i < 100; i++) { if (check()) return; await delay(); }
    assert.fail('UI condition timed out');
}
test('version validation and approval cannot cross identity or version boundaries', async () =>
{
    const { parseSnapshot, canApprove } = await moduleBundle('model');
    assert.equal(parseSnapshot(snapshot()).workbench.tasks.length, 4);
    assert.throws(() => parseSnapshot({ ...snapshot(), schema_version: 1 }));
    const bad = snapshot(); bad.workbench.tasks[0].progress = 500;
    assert.throws(() => parseSnapshot(bad));
    assert.equal(canApprove('design', 'v1.3', fixture), true);
    assert.equal(canApprove('admin', 'v1.3', fixture), false);
    assert.equal(canApprove('design', 'v1.2', fixture), false);
    assert.equal(canApprove('design', 'v1.3', { ...fixture, requirement: { ...fixture.requirement, status: '已批准' } }), false);
});
test('host bridge verifies source, modes, refusal, errors and external mode changes', async () =>
{
    const requests = [], handlers = {};
    const parent = { postMessage: message => requests.push(message) };
    const window = { parent, addEventListener: (name, fn) => handlers[name] = fn, removeEventListener: name => delete handlers[name] };
    const { TrackBridge } = await moduleBundle('bridge', { window });
    const bridge = new TrackBridge();
    const reply = (result, error) => handlers.message({ source: parent, data: { jsonrpc: '2.0', id: requests.at(-1).id, result, error } });
    try
    {
        const loading = bridge.refresh();
        assert.equal(requests[0].method, 'ui/initialize');
        reply({ hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } });
        await delay();
        reply({ structuredContent: snapshot() });
        assert.equal((await loading).workbench.tasks.length, 4);
        let changing = bridge.display('fullscreen'); reply({ mode: 'fullscreen' }); await changing;
        assert.equal(bridge.mode, 'fullscreen');
        changing = bridge.display('inline'); reply({ mode: 'fullscreen' }); await assert.rejects(changing, /未切换/);
        changing = bridge.display('inline'); reply(undefined, { message: '拒绝' }); await assert.rejects(changing, /拒绝/);
        changing = bridge.display('inline'); reply({ mode: 'inline' }); await changing;
        handlers.message({ source: {}, data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } } });
        assert.equal(bridge.mode, 'inline');
        handlers.message({ source: parent, data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } } });
        assert.equal(bridge.mode, 'fullscreen');
    }
    finally { bridge.dispose(); }
});
for (const storage of ['demo', 'postgres'])
{
test('actual bundled workbench gates approval in ' + storage, async () =>
{
    const html = await readFile(new URL('../../../../GameCLI~/GameCLIServer/public/track.html', import.meta.url), 'utf8');
    const errors = [], methods = [];
    const console = new VirtualConsole();
    console.on('jsdomError', e => { if (e.type !== 'css-parsing' && e.type !== 'not-implemented') errors.push(e.message); });
    const dom = new JSDOM(html, { url: 'http://localhost/track', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console, beforeParse(window)
    {
        window.MessageChannel = class { constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.({}), 0) }; } };
        window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        window.fetch = async (url, options) => { methods.push(options?.method ?? 'GET'); return { ok: true, json: async () => ({ ...snapshot(), mode: storage, is_test: true }) }; };
        window.AbortSignal.timeout ??= () => new window.AbortController().signal;
        window.Element.prototype.scrollTo = () => {};
    } });
    const document = dom.window.document;
    const clickText = (selector, text) =>
    {
        const node = [...document.querySelectorAll(selector)].find(n => n.textContent.replace(/\s/g, '') === text.replace(/\s/g, ''));
        assert.ok(node, `Missing ${text}`); node.click(); return node;
    };
    try
    {
        await until(() => document.querySelector('.ant-card-head-title')?.textContent === '执行中的 Agent');
        for (const label of ['任务与依赖', 'Agent', '版本', '权限', '操作记录', '需求审批', '项目总览'])
        {
            clickText('[role=tab]', label); await delay();
            assert.ok(document.querySelector('.ant-card'));
        }
        clickText('[role=tab]', '需求审批'); await delay();
        assert.ok(document.querySelector('table'));
        assert.ok(document.body.textContent.includes('未关联 HTML 文档'));
        assert.equal([...document.querySelectorAll('button')].some(n => n.textContent.includes('查看需求')), false);
        assert.equal(document.querySelector('.document'), null);
        assert.ok(document.querySelector('.ant-splitter'));
        assert.ok(methods.every(method => method === 'GET'), 'Demo actions must not write remotely');
        assert.deepEqual(errors, []);
    }
    finally { dom.window.close(); }
});

}
