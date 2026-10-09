import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM,VirtualConsole} from 'jsdom';
import {fileURLToPath} from 'node:url';
const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{TaskDetail}from'./TaskDetail';
const task={id:'A-0000269',title:'分层交付',version:'v1.1',description:'来源：DS09\\n范围：原始范围\\n启动条件：可制作\\n交付物：四层资源',criteria:[{kind:'steps',text:'检查四层'}],dependencies:[],status:'待调度',progress:0,content_revision:0};
createRoot(document.getElementById('root')!).render(<TaskDetail task={task} tasks={[]} bridge={null} select={()=>{}} dispatch={()=>{}} dispatchDisabled editable={window.location.search!=='?readonly'} onEditing={v=>{window.editing=v;}} save={async(field,value,reason)=>{window.saved={field,value,reason};}}/>);`,resolveDir:fileURLToPath(new URL('../src',import.meta.url)),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
const delay=()=>new Promise(r=>setTimeout(r,25));
async function until(fn){for(let i=0;i<80;i++){if(fn())return;await delay();}assert.fail('UI timeout');}
function open(search=''){
 const console=new VirtualConsole();
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/track'+search,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,beforeParse(w){
 w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
 w.confirm=()=>true;
 }});dom.window.eval(built.outputFiles[0].text);return dom;
}
test('single item editor saves only the selected field and cancel preserves source',async()=>{
 const dom=open();const d=dom.window.document;
 try{
 await until(()=>d.querySelector('[aria-label="编辑任务范围"]'));
 d.querySelector('[aria-label="编辑任务范围"]').click();
 await until(()=>d.querySelector('[aria-label="编辑内容"]'));
 assert.equal(d.querySelectorAll('.task-item-editor').length,1);
 const textarea=d.querySelector('[aria-label="编辑内容"]');assert.equal(textarea.value,'原始范围');
 const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set;
 setter.call(textarea,'修改范围');textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await delay();
 const save=[...d.querySelectorAll('button')].find(b=>b.textContent.replace(/\s/g,'')==='保存');save.click();
 await until(()=>dom.window.saved);
 assert.equal(dom.window.saved.field,'scope');assert.equal(dom.window.saved.value,'修改范围');
 await until(()=>!d.querySelector('.task-item-editor'));
 d.querySelector('[aria-label="编辑操作处理"]').click();await until(()=>d.querySelector('.task-item-editor'));
 [...d.querySelectorAll('button')].find(b=>b.textContent.replace(/\s/g,'')==='取消').click();await until(()=>!d.querySelector('.task-item-editor'));
 assert.equal(dom.window.saved.field,'scope');assert.equal(dom.window.editing,false);
 }finally{dom.window.close();}
});
test('readonly task exposes disabled pencils without allowing editing',async()=>{
 const dom=open('?readonly');try{await until(()=>dom.window.document.querySelector('.task-detail'));const buttons=[...dom.window.document.querySelectorAll('.task-item-edit')];assert.ok(buttons.length>0);assert.ok(buttons.every(b=>b.disabled));}finally{dom.window.close();}
});
