import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiDeliverySkeleton, validateUiDeliveryPlan } from '../src/database/ui-delivery-plan.js';
import { validatePmPlan } from '../src/database/pm-plans.js';
import { manifestFixture, htmlFixture, planFixture } from './ui-delivery-fixture.js';

const build = manifest => buildUiDeliverySkeleton(htmlFixture(manifest),'v1');

test('one/two windows produce three/six stable tasks; controls do not add tasks',() =>
{
    for (const count of [1,2])
    {
        const manifest = manifestFixture(count);
        const skeleton = build(manifest);
        assert.equal(skeleton.tasks.length,count*3);
        manifest.windows.reverse();
        assert.deepEqual(build(manifest),skeleton);
        manifest.windows[0].controls.push({id:manifest.windows[0].id+'/Text',parent:manifest.windows[0].id+'/Root',type:'TMP_Text',image_mode:null,sibling_index:0,anchor:'#extra'});
        assert.deepEqual(build(manifest),skeleton);
        const plan = planFixture(skeleton);
        plan.tasks.reverse();
        assert.deepEqual(validateUiDeliveryPlan(validatePmPlan(plan),skeleton),planFixture(skeleton));
    }
});

test('reject missing, duplicate, invalid and stale manifests and anchors',() =>
{
    const manifest = manifestFixture();
    const html = htmlFixture(manifest);
    for (const invalid of ['',html+html,html.replace('application/json','text/javascript'),html.replace('"schema_version":1','"schema_version":1,"schema_version":1'),html.replace('"schema_version":1','"schema_version":2'),html.replace('"schema_version":1','invalid'),html.replace('id="root-W01"','id="missing"'),html.replace('id="window-W01"','id="missing"')])
    {
        assert.throws(() => buildUiDeliverySkeleton(invalid,'v1'),/UI 交付清单/);
    }
    assert.throws(() => buildUiDeliverySkeleton(html,'v2'),/版本/);
});

test('reject ownership, parent cycles, sibling collisions and changed delivery edges',() =>
{
    for (const mutate of [
        m => m.windows.push(m.windows[0]),
        m => m.windows[0].controls[0].parent = 'W01/Missing',
        m => m.windows[0].controls.push({...m.windows[0].controls[0]}),
        m => m.windows[0].deliveries[1].depends_on = [],
        m => m.windows[0].deliveries[1].role = 'Prefab',
        m => m.windows[0].parent_window = 'W02',
        m => m.windows[0].controls.push({id:'W01/Child',parent:'W01/Child',type:'Panel',image_mode:null,sibling_index:0,anchor:'#child'})
    ])
    {
        const manifest = manifestFixture();
        mutate(manifest);
        assert.throws(() => build(manifest),/UI 交付清单/);
    }
});

test('reject added, missing, repeated, renamed, re-roled, re-sourced or rewired tasks',() =>
{
    const skeleton = build(manifestFixture());
    for (const mutate of [
        p => p.tasks.push({...p.tasks[0],id:'EXTRA'}), p => p.tasks.pop(),
        p => p.tasks[1] = p.tasks[0], p => p.tasks[0].id = 'OTHER',
        p => p.tasks[0].role = 'Art', p => p.tasks[0].source_refs = ['#other'],
        p => p.tasks[1].depends_on = [], p => p.tasks[1].depends_on.push('W01-WHITEBOX')
    ])
    {
        const plan = planFixture(skeleton);
        mutate(plan);
        assert.throws(() => validateUiDeliveryPlan(plan,skeleton),/UI 交付清单/);
    }
});

test('resource mappings validate mode/size/owner and explicit cross-window assembly dependency',() =>
{
    const manifest = manifestFixture(2);
    for (const window of manifest.windows)
    {
        window.controls.push({id:window.id+'/Image',parent:window.id+'/Root',type:'Image',image_mode:'sliced',sibling_index:0,anchor:'#image-'+window.id});
    }
    manifest.windows[0].resources.push({id:'R01',owner_window:'W01',target_controls:['W01/Image','W02/Image'],generate:true,kind:'sliced',size:[128,128],slice_border:[8,8,8,8]});
    assert.throws(() => build(manifest),/依赖/);
    manifest.windows[1].deliveries[2].depends_on.push('W01-ART');
    assert.equal(build(manifest).tasks.length,6);
    for (const mutate of [r => r.owner_window = 'W02',r => r.target_controls = ['W01/Root'],r => r.size = [0,1],r => r.slice_border = [128,0,0,0]])
    {
        const copy = structuredClone(manifest);
        mutate(copy.windows[0].resources[0]);
        assert.throws(() => build(copy),/UI 交付清单/);
    }
});


test('internal regions stay in their owner section without becoming tasks',() =>
{
    const manifest = manifestFixture();
    manifest.windows.push({id:'W01-INNER',name:'内部展开层',independent:false,parent_window:'W01',anchor:'#internal',controls:[],resources:[],deliveries:[]});
    const html = htmlFixture(manifest).replace('</section>','<div id="internal">内部区域</div></section>');
    assert.equal(buildUiDeliverySkeleton(html,'v1').tasks.length,3);
    assert.throws(() => buildUiDeliverySkeleton(html.replace('<div id="internal">内部区域</div>','')+'<div id="internal"></div>','v1'),/内部区域/);
});

test('invalid input is rejected before invoking PM',async () =>
{
    const {dispatchPmJob} = await import('../src/track/pm-dispatch.js');
    const {randomUUID} = await import('node:crypto');
    let called = false;
    const failures = [];
    const pool = {query:async (sql,params) => { failures.push(params); return {rows:[]}; }};
    await dispatchPmJob(pool,'TEST',{job:{id:'test',execution_id:randomUUID().replaceAll('-','')},document:{html:'<html></html>',version:'v1'}},async () => {called=true;});
    assert.equal(called,false);
    assert.equal(failures.length,1);
    assert.match(failures[0][2],/ui-production-contract/);
});


test('v2 preserves internal identity and enforces actual prefab/node names',() =>
{
    const m = manifestFixture(2);
    m.schema_version = 2;
    m.windows.forEach((w,i) => {w.prefab_name = i === 0 ? 'UILogin.prefab' : 'UIReasonToast.prefab';w.controls[0].name = w.prefab_name.slice(0,-7);});
    const skeleton = build(m);
    assert.equal(skeleton.schema_version,2);
    assert.equal(skeleton.tasks[0].id,'W01-WHITEBOX');
    assert.equal(skeleton.tasks[0].prefab_name,'UILogin.prefab');
    for (const change of [
        v => delete v.windows[0].prefab_name,
        v => v.windows[0].prefab_name = 'Login.prefab',
        v => v.windows[0].controls[0].name = 'S0 L00',
        v => v.windows[0].controls[0].name = 'WrongRoot',
        v => {v.windows[1].prefab_name = 'UILogin.prefab';v.windows[1].controls[0].name = 'UILogin';},
        v => {v.windows[0].controls.push({id:'W01/A',name:'Same',parent:'W01/Root',type:'Panel',image_mode:null,sibling_index:0,anchor:'#child-a'},{id:'W01/B',name:'Same',parent:'W01/Root',type:'Panel',image_mode:null,sibling_index:1,anchor:'#child-b'});}
    ])
    {
        const invalid = structuredClone(m);
        change(invalid);
        assert.throws(() => build(invalid),/UI 交付清单/);
    }
});

test('v2 accepts approved lowerCamelCase without weakening root identity', () =>
{
    const m = manifestFixture(1);
    m.schema_version = 2;
    m.windows[0].prefab_name = 'UILogin.prefab';
    m.windows[0].controls[0].name = 'uiLogin';
    assert.equal(build(m).tasks.length, 3);
    for (const name of ['ui_Login', 'uiShop', '1Login'])
    {
        m.windows[0].controls[0].name = name;
        assert.throws(() => build(m), /UI 交付清单/);
    }
});

test('solid Images preserve sprite-less controls without fabricated resources', () =>
{
    const m = manifestFixture(1);
    m.windows[0].controls.push({id:'W01/HitArea',parent:'W01/Root',type:'Image',image_mode:'solid',sibling_index:0,anchor:'#hit-area'});
    assert.equal(build(m).tasks.length, 3);
    m.windows[0].controls.at(-1).image_mode = 'static';
    assert.throws(() => build(m), /资源映射/);
});
