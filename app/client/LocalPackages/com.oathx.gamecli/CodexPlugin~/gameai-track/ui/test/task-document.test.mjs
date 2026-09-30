import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/task-document.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};
runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,DOMParser:new JSDOM('').window.DOMParser});
const {taskWireframes,taskDescription}=module.exports;
const source=`<style>figure{width:100%}</style><figure><h3>P01 入口</h3><svg></svg></figure><figure id="reward-layers"><h3>四层 R01</h3><svg><g data-layer="L1"></g><script>alert(1)</script><foreignObject>unsafe</foreignObject><image href="https://bad.example/a" onload="x()"/></svg></figure><figure><h3>P03 成功</h3><svg></svg></figure>`;
test('wireframe selection preserves source order and layers while removing active markup',()=>{
 const result=taskWireframes(source,['app/desgin/test.html#reward-layers','P03']);
 assert.equal(result.count,2);assert.equal(result.fallback,false);
 assert.ok(result.html.indexOf('四层')<result.html.indexOf('P03'));
 assert.ok(result.html.includes('data-layer="L1"'));
 assert.ok(!result.html.includes('P01'));assert.ok(!result.html.includes('<script'));
 assert.ok(!result.html.includes('foreignObject'));assert.ok(!result.html.includes('onload'));assert.ok(!result.html.includes('https://bad'));
});
test('missing precise references explicitly falls back to context; absent figures stays empty',()=>{
 assert.equal(taskWireframes(source,['缺少锚点']).fallback,true);
 assert.equal(taskWireframes('<p>纯逻辑</p>',[]).count,0);
});
test('deliverables move after scope rather than mixing the two sections',()=>{
 const result=taskDescription('来源：DS09\n范围：R01\n交付物：分层资源\n启动条件：资源未齐\n完成条件：检查通过');
 assert.deepEqual(Array.from(result.details),['来源：DS09','范围：R01','启动条件：资源未齐']);
 assert.deepEqual(Array.from(result.delivery),['交付物：分层资源','完成条件：检查通过']);
});
