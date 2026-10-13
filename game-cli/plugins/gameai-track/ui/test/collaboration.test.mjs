import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM,VirtualConsole} from 'jsdom';
import {fileURLToPath} from 'node:url';
const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CollaborationChat}from'./CollaborationChat';
const message={id:'2',created_at:'2026-10-10T10:00:00Z',actor_name:'RodFergusson',role:'PM',event:'需求退回修订',body:'<img src=x onerror=alert(1)>需要修正数量',level:'error',requirement_key:'LOGIN',version:'v1.2',task_key:'F-0000001',task_id:'task-uuid',task_available:true,document_available:false};
const bridge={collaboration:async(q)=>{window.queries=(window.queries||[]).concat([q]);return q.before?{messages:[{...message,id:'1',actor_name:'审批人',role:'Human'}],before:null}:{messages:[message],before:'2'};}};
createRoot(document.getElementById('root')!).render(<CollaborationChat bridge={bridge} openTask={id=>window.opened=id} openDocument={()=>{}}/>);`,resolveDir:fileURLToPath(new URL('../src',import.meta.url)),loader:'tsx'},loader:{'.css':'empty'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
const delay=()=>new Promise(r=>setTimeout(r,25));
async function until(fn){for(let i=0;i<80;i++){if(fn())return;await delay();}assert.fail('UI timeout');}
test('read-only chat renders safe bubbles, loads older messages and opens task references',async()=>
{
    const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/track',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};}});
    try
    {
        dom.window.eval(built.outputFiles[0].text);const d=dom.window.document;
        await until(()=>d.querySelector('.collaboration-bubble'));
        assert.match(d.body.textContent,/RodFergusson/);assert.equal(d.querySelector('.collaboration-body img'),null);
        assert.equal(d.querySelector('textarea'),null);
        [...d.querySelectorAll('button')].find(b=>b.textContent==='F-0000001').click();
        assert.equal(dom.window.opened,'task-uuid');
        [...d.querySelectorAll('button')].find(b=>b.textContent.includes('加载更早')).click();
        await until(()=>d.querySelectorAll('.collaboration-message').length===2);
        assert.equal(d.querySelectorAll('.collaboration-message--human').length,1);
        assert.ok(dom.window.queries.some(q=>q.before==='2'));
    }
    finally{dom.window.close();}
});
