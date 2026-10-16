import test from 'node:test';
import assert from 'node:assert/strict';
import {packContext,prepareUiDocumentPrompt} from '../src/database/ui-document-prompt.js';
import {embedUiTemplateContext,readUiTemplateContext} from '../src/database/ui-template-context.js';

function unpack(packed)
{
    function expand(value)
    {
        if (!value || typeof value!=='object') return value;
        if (Object.hasOwn(value,'$contextRef')) return expand(packed.definitions[value.$contextRef]);
        return Array.isArray(value) ? value.map(expand) : Object.fromEntries(Object.entries(value).map(([k,v])=>[k,expand(v)]));
    }
    return expand(packed.data);
}
test('tool-enabled specialist input references full immutable context without expanding it',()=>
{
    const payload={nodes:Array.from({length:1000},(_,id)=>({id,text:'unique-'+id+'x'.repeat(100)}))};
    const html=embedUiTemplateContext('<html><body><section>Approved</section></body></html>',payload);
    const context=readUiTemplateContext(html);
    const reference={path:'app/desgin/approved/test.html',sha256:'a'.repeat(64)};
    const prompt=prepareUiDocumentPrompt(html,reference);
    assert.ok(prompt.includes(reference.path));
    assert.ok(prompt.includes(context.sha256));
    assert.ok(prompt.includes('<section>Approved</section>'));
    assert.ok(!prompt.includes('unique-999'));
    assert.ok(prompt.length<2000);
    assert.deepEqual(readUiTemplateContext(html).payload,payload);
    assert.throws(()=>prepareUiDocumentPrompt(html,{}),/immutable/);
});
test('nested repeated nodes and attributes round trip without omissions',()=>{
    const attributes={name:'node',active:false,size:[0,128],text:'多语言😀'.repeat(50),nullable:null};
    const payload={nodes:[{attributes},{attributes}],history:{attributes},empty:[],unique:{value:42}};
    const packed=packContext(payload);
    assert.deepEqual(unpack(packed),payload);
    assert.ok(JSON.stringify(packed).length<JSON.stringify(payload).length);
    assert.deepEqual(packContext(payload),packed);
    assert.throws(()=>packContext({nested:{$contextRef:'user value'}}),/Reserved/);
});
test('prompt retains visible HTML and provides full attachment data, original stays immutable',()=>{
    const payload={values:Array.from({length:30},()=>({text:'x'.repeat(1000)}))};
    const html=embedUiTemplateContext('<html><body><section>Original</section></body></html>',payload);
    const hash=readUiTemplateContext(html).sha256;
    const prompt=prepareUiDocumentPrompt(html);
    assert.ok(prompt.includes('<section>Original</section>'));
    assert.ok(prompt.includes(hash));
    assert.deepEqual(unpack(JSON.parse(prompt.slice(prompt.indexOf('{"encoding"')))),payload);
    assert.equal(readUiTemplateContext(html).sha256,hash);
    assert.ok(prompt.length<html.length);
});
import {createHash} from 'node:crypto';
test('baseline review transport retains every parsed value and raw-byte identity',()=>
{
    const baseline = {schemaVersion:'ui-template/1',nodes:[{text:'中文',active:false,rect:[1,2]}]};
    const raw = JSON.stringify(baseline,null,4)+'\r\n';
    const html = embedUiTemplateContext('<html><body></body></html>',{guardBaselineJson:raw});
    const prompt = prepareUiDocumentPrompt(html);
    const payload = unpack(JSON.parse(prompt.slice(prompt.indexOf('{"encoding"'))));
    assert.deepEqual(payload.guardBaselineJson.value,baseline);
    assert.equal(payload.guardBaselineJson.rawSha256,createHash('sha256').update(raw,'utf8').digest('hex'));
    assert.equal(readUiTemplateContext(html).payload.guardBaselineJson,raw);
});
