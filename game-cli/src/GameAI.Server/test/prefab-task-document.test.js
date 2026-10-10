import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildPrefabTaskHtml} from '../src/database/prefab-task-document.js';
const html = '<html><head><style>.rule{color:red}</style></head><body><svg><defs><g id="shared"><rect width="10"/></g></defs></svg><section id="ui"><h1>UI</h1><section id="login"><h2>3.1 Login</h2><h3>3.1.1 Window</h3><div id="wire-login"><svg><use href="#shared"/></svg></div><h3>3.1.2 Hierarchy</h3><pre>Panel &gt; Text</pre><h3>3.1.3 Controls</h3><table><tr><td class="rule">Button</td></tr></table></section><section id="other"><h2>Other window</h2></section></section></body></html>';
const hash = createHash('sha256').update(html).digest('hex');
const task = {task_key:'F-0000001',title:'Login',source_refs:['app/desgin/approved.html#wire-login']};
test('retains exact full window source, styles and external SVG definitions',()=>{
 const result=buildPrefabTaskHtml(html,task,hash);
 const exact=html.slice(html.indexOf('<section id="login">'),html.indexOf('<section id="other">'));
 assert.ok(result.includes(exact)); assert.ok(result.includes('<defs><g id="shared">'));
 assert.ok(result.includes('.rule{color:red}')); assert.ok(!result.includes('Other window'));
 assert.ok(result.includes("script-src 'none'")); assert.ok(result.includes(hash));
});
test('missing source and hash mismatches fail closed',()=>{
 assert.throws(()=>buildPrefabTaskHtml(html,{...task,source_refs:['#missing']},hash),/anchor/);
 assert.throws(()=>buildPrefabTaskHtml(html,task,'0'.repeat(64)),/hash mismatch/);
});
test('flat heading documents retain sibling subsections until next window',()=>{
 const flat='<h2 id="one">3.1 Window</h2><h3>3.1.1 Wire</h3><p>text</p><h3>3.1.2 Controls</h3><table></table><h2>3.2 Other</h2>';
 const result=buildPrefabTaskHtml(flat,{...task,source_refs:['#one']},createHash('sha256').update(flat).digest('hex'));
 assert.ok(result.includes('3.1.2 Controls')); assert.ok(!result.includes('3.2 Other'));
});
