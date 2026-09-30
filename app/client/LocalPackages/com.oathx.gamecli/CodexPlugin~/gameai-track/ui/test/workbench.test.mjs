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
        await until(() => document.querySelector('.ant-card-head-title')?.textContent === 'Agent');
        for (const label of ['任务与依赖', '版本', '权限', '操作记录', '需求审批', '项目总览'])
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


for (const automatic of [false,true]) test('authenticated review selects only the opened version; automatic='+automatic, async () =>
{
    const html = await readFile(new URL('../../../../GameCLI~/GameCLIServer/public/track.html', import.meta.url), 'utf8');
    const state = snapshot();
    state.mode = 'postgres';
    const selected = { ...state.workbench.requirement, id: 'SECOND', title: '第二个需求', version: 'v2', revision: 'b'.repeat(64),
        version_id: '22222222-2222-4222-8222-222222222222', document_hash: 'c'.repeat(64), document_path: 'uploaded/second.html', document_url: '/api/track/documents/second', created_at: null };
    state.workbench.requirements = [selected];
    const writes = [];
    const dom = new JSDOM(html, { url: 'http://localhost/track', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), beforeParse(window)
    {
        window.MessageChannel = class { constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.({}), 0) }; } };
        window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        window.AbortSignal.timeout ??= () => new window.AbortController().signal;
        window.Element.prototype.scrollTo = () => {};
        window.fetch = async (url, options) =>
        {
            if (url.endsWith('/review-session')) return { ok: true, json: async () => ({ authenticated: true, name: '测试审批人', csrf: 'test-csrf' }) };
            if (url.endsWith('/review-decisions'))
            {
                writes.push(JSON.parse(options.body));
                selected.status = '已批准';
                return { ok: true, json: async () => ({ decision: 'approved' }) };
            }
            return { ok: true, json: async () => structuredClone(state) };
        };
    } });
    const document = dom.window.document;
    const find = (selector,text) => [...document.querySelectorAll(selector)].find(n => n.textContent.replace(/\s/g,'') === text);
    try
    {
        await until(() => document.querySelector('.ant-card'));
        find('[role=tab]','需求审批').click();
        await until(() => find('a','second.html'));
        find('a','second.html').click();
        await until(() => find('button','同意') && !find('button','同意').disabled);
        assert.equal(document.querySelector('iframe').getAttribute('sandbox'),'');
        find('button','同意').click();
        await until(() => find('button','确认'));
        const autoLabel=[...document.querySelectorAll('label')].find(n=>n.textContent.includes('批准后自动启动 PM'));
        assert.ok(autoLabel);
        assert.equal(autoLabel.querySelector('input').checked,false);
        if (automatic) autoLabel.querySelector('input').click();
        find('button','确认').click();
        await until(() => writes.length === 1);
        assert.equal(writes[0].auto_start===true,automatic);
        assert.equal(writes[0].version_id,selected.version_id);
        assert.equal(writes[0].revision,'b'.repeat(64));
        assert.equal(writes[0].document_hash,'c'.repeat(64));
        assert.equal(writes[0].decision,'approved');
    }
    finally { dom.window.close(); }
});

test('manual PM action uses approved row, sends CSRF and locks while running', async () =>
{
    const html = await readFile(new URL('../../../../GameCLI~/GameCLIServer/public/track.html', import.meta.url), 'utf8');
    const state = snapshot();
    state.mode = 'postgres';
    const row = {...state.workbench.requirement,id:'PM-REQ',status:'已批准',version_id:'22222222-2222-4222-8222-222222222222',document_hash:'a'.repeat(64),document_path:null,created_at:null};
    state.workbench.requirements = [row];
    const writes = [];
    const dom = new JSDOM(html,{url:'http://localhost/track',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(window)
    {
        window.MessageChannel = class { constructor() { this.port1={onmessage:null};this.port2={postMessage:()=>setTimeout(()=>this.port1.onmessage?.({}),0)}; } };
        window.matchMedia = () => ({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
        window.ResizeObserver = class {observe(){} unobserve(){} disconnect(){}};
        window.AbortSignal.timeout ??= () => new window.AbortController().signal;
        window.Element.prototype.scrollTo = () => {};
        window.fetch = async (url,options) =>
        {
            if (url.endsWith('/review-session')) return {ok:true,json:async()=>({authenticated:true,name:'测试审批人',csrf:'pm-csrf'})};
            if (options?.method === 'POST')
            {
                assert.ok(url.endsWith('/review-pm-split'));
                writes.push({body:JSON.parse(options.body),csrf:options.headers['X-GameAI-Review-CSRF']});
                row.pm_job = {state:'running',error:'',attempts:1,task_count:0};
                return {ok:true,json:async()=>({state:'running',repeated:false})};
            }
            return {ok:true,json:async()=>structuredClone(state)};
        };
    }});
    const doc=dom.window.document;
    const find=(selector,text)=>[...doc.querySelectorAll(selector)].find(n=>n.textContent.replace(/\s/g,'')===text.replace(/\s/g,''));
    try
    {
        await until(()=>doc.querySelector('.ant-card'));
        find('[role=tab]','需求审批').click();
        await until(()=>find('button','PM 拆分任务') && !find('button','PM 拆分任务').disabled);
        assert.equal(writes.length,0,'Approval alone must not dispatch');
        find('button','PM 拆分任务').click();
        await until(()=>writes.length===1);
        assert.equal(writes[0].body.version_id,row.version_id);
        assert.equal(writes[0].body.document_hash,row.document_hash);
        assert.equal(writes[0].csrf,'pm-csrf');
        await until(()=>find('button','PM 拆分中')?.disabled);
        find('button','PM 拆分中').click();
        await delay();
        assert.equal(writes.length,1);
    }
    finally {dom.window.close();}
});

test('task tree keeps ancestors for filtered descendants', async () =>
{
    const {buildTaskTree}=await moduleBundle('task-tree');
    const root={id:'T-0000001',parent_id:null};
    const child={id:'A-0000002',parent_id:root.id};
    const leaf={id:'P-0000003',parent_id:child.id};
    const tree=buildTaskTree([leaf],[root,child,leaf,{id:'T-0000004'}]);
    assert.equal(tree.length,1);
    assert.equal(tree[0].id,root.id);
    assert.equal(tree[0].children[0].children[0].id,leaf.id);
});

test('task tree expands children and checkbox persists only dispatch permission', async () =>
{
    const html=await readFile(new URL('../../../../GameCLI~/GameCLIServer/public/track.html',import.meta.url),'utf8');
    const state=snapshot();
    state.mode='postgres';
    const base={title:'测试任务',agent:null,status:'待调度',progress:0,dependencies:[],version:'v1',dispatch_allowed:false,dispatch_revision:0};
    const root={...base,id:'T-0000001',role:'PM',parent_id:null};
    const child={...base,id:'P-0000002',role:'Development',parent_id:root.id,task_uuid:'22222222-2222-4222-8222-222222222222'};
    state.workbench.tasks=[root,child];
    const writes=[];
    const dom=new JSDOM(html,{url:'http://localhost/track',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(window)
    {
        window.MessageChannel=class {constructor(){this.port1={onmessage:null};this.port2={postMessage:()=>setTimeout(()=>this.port1.onmessage?.({}),0)};}};
        window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
        window.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
        window.AbortSignal.timeout ??= ()=>new window.AbortController().signal;
        window.Element.prototype.scrollTo=()=>{};
        window.fetch=async(url,options)=>
        {
            if(url.endsWith('/review-session')) return {ok:true,json:async()=>({authenticated:true,name:'测试审批人',csrf:'tree-csrf'})};
            if(options?.method==='POST')
            {
                if (url.endsWith('/review-task-preview') || url.endsWith('/review-task-dispatch'))
                {
                    const body=JSON.parse(options.body);
                    assert.equal(options.headers['X-GameAI-Review-CSRF'],'tree-csrf');
                    assert.equal(body.tasks[0].task_id,child.task_uuid);
                    window.taskDispatchChecks=(window.taskDispatchChecks ?? 0)+1;
                    if (url.endsWith('-dispatch')) window.taskDispatchStarts=(window.taskDispatchStarts ?? 0)+1;
                    return {ok:true,json:async()=>({started:1,rows:[{task_id:child.task_uuid,id:child.id,title:child.title,role:child.role,agent:'dev-01',ready:true,reason:'可立即派发'}]})};
                }
                assert.ok(url.endsWith('/review-task-selection'));
                const input=JSON.parse(options.body);
                writes.push(input);
                assert.equal(options.headers['X-GameAI-Review-CSRF'],'tree-csrf');
                child.dispatch_allowed=input.allowed;
                child.dispatch_revision++;
                return {ok:true,json:async()=>({dispatch_allowed:child.dispatch_allowed,dispatch_revision:child.dispatch_revision})};
            }
            return {ok:true,json:async()=>structuredClone(state)};
        };
    }});
    const doc=dom.window.document;
    try
    {
        await until(()=>doc.querySelector('.ant-card'));
        [...doc.querySelectorAll('[role=tab]')].find(n=>n.textContent==='任务与依赖').click();
        await until(()=>doc.querySelector('.ant-table-row-expand-icon'));
        assert.equal(doc.querySelectorAll('.ant-table input[type=checkbox]').length,0,'Parent must not have a dispatch checkbox');
        doc.querySelector('.ant-table-row-expand-icon').click();
        await until(()=>doc.querySelectorAll('.ant-table-row-expand-icon-collapsed').length===1);
        assert.match(doc.body.textContent,/程序（1）/);
        assert.equal(doc.querySelectorAll('.ant-table input[type=checkbox]').length,0,'Role folders are view-only');
        doc.querySelector('.ant-table-row-expand-icon-collapsed').click();
        const checkbox=()=>doc.querySelector('input[aria-label="允许派发 P-0000002"]');
        await until(()=>checkbox() && !checkbox().disabled);
        assert.equal(writes.length,0);
        checkbox().click();
        await until(()=>checkbox()?.checked && !checkbox().disabled);
        assert.equal(writes[0].task_id,child.task_uuid);
        assert.equal(writes[0].revision,0);
        assert.equal(writes[0].allowed,true);
        checkbox().click();
        await until(()=>writes.length===2 && !checkbox().checked);
        assert.equal(writes[1].revision,1);
        assert.equal(writes[1].allowed,false);
        checkbox().click();
        await until(()=>writes.length===3 && checkbox().checked && !checkbox().disabled);
        const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent.includes(text));
        button('派发已勾选任务').click();
        await until(()=>button('确认派发可执行任务'));
        assert.equal(dom.window.taskDispatchStarts,undefined,'Preview must not start an Agent');
        button('确认派发可执行任务').click();
        button('确认派发可执行任务').click();
        await until(()=>dom.window.taskDispatchStarts===1);
        assert.equal(dom.window.taskDispatchChecks,2);
    }
    finally {dom.window.close();}
});

test('role folders preserve IDs, dependencies, counts and filtered ancestor context', async () =>
{
    const {groupTaskTree,expandableTaskKeys}=await moduleBundle('task-tree');
    const root={id:'T-0000001',role:'PM',parent_id:null};
    const art={id:'A-0000002',role:'Art',parent_id:root.id,status:'已完成',dependencies:[]};
    const dev={id:'P-0000003',role:'Development',parent_id:root.id,status:'依赖阻塞',dependencies:[art.id]};
    const all=[root,dev,art];
    const tree=groupTaskTree(all,all);
    assert.deepEqual(Array.from(tree[0].children,g=>g.role),['Art','Development']);
    assert.deepEqual({...tree[0].children[0].group},{total:1,completed:1,blocked:0});
    assert.equal(tree[0].children[1].group.blocked,1);
    assert.equal(tree[0].children[1].children[0].id,dev.id);
    assert.deepEqual(tree[0].children[1].children[0].dependencies,[art.id]);
    const filtered=groupTaskTree([dev],all);
    assert.equal(filtered[0].id,root.id);
    assert.equal(filtered[0].children.length,1);
    assert.equal(filtered[0].children[0].children[0].id,dev.id);
    assert.deepEqual(Array.from(expandableTaskKeys(filtered)),[root.id,`role-group:${root.id}:Development`]);
    assert.equal(all.length,3);
    assert.equal(root.children,undefined);
});


test('workflow output restores durable events, refreshes idle work and does not duplicate snapshots', async () =>
{
    const html=await readFile(new URL('../../../../GameCLI~/GameCLIServer/public/track.html',import.meta.url),'utf8');
    const state={...snapshot(),mode:'postgres'};
    state.workbench.tasks=[];
    state.workbench.agents=[];
    state.workbench.activity=[{id:'1',time:new Date().toISOString(),actor:'human',requirement:'HELLO-WORLD',task:null,level:'info',message:'人工批准需求版本'}];
    let poll, reads=0;
    const dom=new JSDOM(html,{url:'http://localhost/track',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(window)
    {
        window.MessageChannel=class {constructor(){this.port1={onmessage:null};this.port2={postMessage:()=>setTimeout(()=>this.port1.onmessage?.({}),0)};}};
        window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
        window.ResizeObserver=class {observe(){} unobserve(){} disconnect(){}};
        window.AbortSignal.timeout ??= ()=>new window.AbortController().signal;
        window.setInterval=(fn)=>{poll=fn;return 1;};
        window.clearInterval=()=>{};
        window.fetch=async url=>{if(url.endsWith('review-session')) return {ok:true,json:async()=>({authenticated:false})}; reads++;return {ok:true,json:async()=>structuredClone(state)};};
    }});
    try
    {
        const output=()=>dom.window.document.querySelector('[aria-label="工作流执行日志"]');
        await until(()=>output()?.textContent.includes('人工批准需求版本') && poll);
        assert.doesNotMatch(output().textContent,/数据库快照已更新/);
        state.workbench.activity.push({id:'2',time:new Date().toISOString(),actor:'dev-01',requirement:'HELLO-WORLD',task:'P-0000195',level:'error',message:'任务执行失败；编译失败'});
        poll();
        await until(()=>output()?.textContent.includes('编译失败'));
        poll();
        await until(()=>reads>=3);
        await delay();
        assert.equal(output().textContent.split('编译失败').length-1,1);
        assert.match(output().textContent,/P-0000195/);
        assert.match(output().textContent,/dev-01/);
    }
    finally {dom.window.close();}
});


test('all workbench data tables use the shared resizable table',async()=>
{
    const {readdir}=await import('node:fs/promises');
    const directory=new URL('../src/',import.meta.url);
    for(const name of await readdir(directory))
    {
        if(!name.endsWith('.tsx') || name==='ResizableTable.tsx') continue;
        const source=await readFile(new URL(name,directory),'utf8');
        assert.doesNotMatch(source,/<Table(?:\s|<)/,name+' must use ResizableTable');
    }
});

test('aggregate progress counts executable leaves and stays stable when filtered', async () =>
{
    const {groupTaskTree,taskProgress}=await moduleBundle('task-tree');
    const root={id:'T-1',role:'PM',parent_id:null};
    const dev={id:'P-1',role:'Development',parent_id:'T-1',status:'已完成'};
    const qa={id:'Q-1',role:'QA',parent_id:'T-1',status:'待验收'};
    const failed={id:'P-2',role:'Development',parent_id:'T-1',status:'失败'};
    const all=[root,dev,qa,failed];
    const tree=groupTaskTree([failed],all);
    assert.deepEqual({...tree[0].aggregate},{total:3,completed:1,failed:1,percent:33});
    assert.deepEqual({...tree[0].children[0].aggregate},{total:2,completed:1,failed:1,percent:50});
    assert.equal(tree[0].children[0].children[0].aggregate,undefined);
    assert.deepEqual({...taskProgress(root.id,[root])},{total:0,completed:0,failed:0,percent:0});
    const nested=[root,{id:'P-parent',parent_id:root.id,role:'Development',status:'已完成'},{id:'P-leaf',parent_id:'P-parent',role:'Development',status:'失败'}];
    assert.deepEqual({...taskProgress(root.id,nested)},{total:1,completed:0,failed:1,percent:0});
});

test('history presentation extracts task JSON and HTML without losing original context', async () =>
{
    const {parseReadableMessage}=await moduleBundle('readable-message');
    const html='<html><body>{文档} <script>ignored()</script></body></html>';
    const payload={task:'P-1',title:'开发问候程序',description:'创建控制台',criteria:[{kind:'steps',text:'启动程序'}],dependencies:['A-1'],approved_html:html,platform_context:{approval:'approved'}};
    const source='附加执行规则\n'+JSON.stringify(payload)+'\n保留后记';
    const parsed=parseReadableMessage(source);
    assert.equal(parsed.title,'P-1 · 开发问候程序');
    assert.equal(parsed.html,html);
    assert.ok(parsed.sections.some(s=>s.text==='操作步骤\n启动程序'));
    assert.ok(parsed.technical.includes('附加执行规则'));
    assert.ok(parsed.technical.includes('保留后记'));
    assert.ok(parsed.technical.includes('platform_context'));
    assert.ok(!parsed.technical.includes('<html>'));
    const pm=parseReadableMessage('需求：HELLO\n文档 SHA256：abc\n以下是已批准的原始 HTML 数据：\n'+html);
    assert.equal(pm.html,html);
    assert.equal(pm.text,'需求：HELLO');
    assert.ok(pm.technical.includes('abc'));
    assert.equal(parseReadableMessage('普通需求文本'),undefined);
    assert.equal(parseReadableMessage('{"unknown":1}'),undefined);
    assert.equal(parseReadableMessage('{"task":"P-1",invalid}'),undefined);
});

test('embedded requirement uses MCP HTML and retains a human login entry without allowing approval', async () =>
{
    const html = await readFile(new URL('../../../../GameCLI~/GameCLIServer/public/track.html', import.meta.url), 'utf8');
    const state = snapshot(); state.mode = 'postgres'; state.review_url = 'http://127.0.0.1:18090/track';
    const row = {...state.workbench.requirement,id:'EMBED-1',status:'待审批',version_id:'22222222-2222-4222-8222-222222222222',document_hash:'a'.repeat(64),document_path:'uploaded/embedded.html',document_url:'/api/track/documents/relative'};
    state.workbench.requirements=[row];
    const calls=[];
    const dom = new JSDOM(html,{url:'https://host.invalid/ui',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(window)
    {
        const parent={postMessage(message)
        {
            if (!message.id) return;
            calls.push(message);
            let result={};
            if(message.method==='ui/initialize') result={hostContext:{displayMode:'inline',availableDisplayModes:['inline','fullscreen']}};
            if(message.method==='tools/call') result={structuredContent: message.params.arguments.document_version ? {...state,document:{version_id:row.version_id,html:'<!doctype html><html><body>真实需求原文</body></html>'}} : state};
            setTimeout(()=>window.dispatchEvent(new window.MessageEvent('message',{source:parent,data:{jsonrpc:'2.0',id:message.id,result}})),0);
        }};
        Object.defineProperty(window,'parent',{value:parent});
        window.MessageChannel=class {constructor(){this.port1={onmessage:null};this.port2={postMessage:()=>setTimeout(()=>this.port1.onmessage?.({}),0)};}};
        window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
        window.ResizeObserver=class {observe(){} unobserve(){} disconnect(){}};
        window.Element.prototype.scrollTo=()=>{};
        window.fetch=()=>{throw new Error('Embedded view must not fetch relative HTTP endpoints');};
    }});
    const d=dom.window.document;
    const find=(selector,text)=>[...d.querySelectorAll(selector)].find(n=>n.textContent.replace(/\s/g,'')===text);
    try
    {
        await until(()=>find('button','审批人登录'));
        find('[role=tab]','需求审批').click();
        await until(()=>find('a','embedded.html')); find('a','embedded.html').click();
        await until(()=>d.querySelector('iframe')?.getAttribute('srcdoc')?.includes('真实需求原文'));
        assert.equal(d.querySelector('iframe').getAttribute('src'),null);
        assert.equal(d.querySelector('iframe').getAttribute('sandbox'),'');
        assert.equal(find('button','同意').disabled,true);
        find('button','审批人登录').click();
        await until(()=>calls.some(c=>c.method==='ui/open-link'));
        assert.equal(calls.find(c=>c.method==='ui/open-link').params.url,state.review_url);
        assert.ok(calls.some(c=>c.method==='tools/call' && c.params.arguments.document_version===row.version_id));
    }
    finally {dom.window.close();}
});
