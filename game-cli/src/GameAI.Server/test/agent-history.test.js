import test from 'node:test';
import assert from 'node:assert/strict';
import {publicMessages} from '../src/track/conversation-reader.js';

test('history exposes only user text and public replies, preserving order and complete text', () =>
{
    const full = '<script>untrusted()</script>' + '完整回复'.repeat(4000);
    const messages = publicMessages({turns:[{id:'turn1',status:'completed',items:[
        {id:'u',type:'userMessage',content:[{type:'text',text:'需求输入'},{type:'image',url:'private'}]},
        {id:'secret',type:'reasoning',text:'must not expose'},
        {id:'system',type:'systemMessage',text:'private rules'},
        {id:'tool',type:'commandExecution',aggregatedOutput:'private logs'},
        {id:'a',type:'agentMessage',text:full}
    ]}]});
    assert.equal(messages.length,2);
    assert.deepEqual(messages.map(m=>m.role),['user','assistant']);
    assert.equal(messages[0].text,'需求输入\n[非文本内容]');
    assert.equal(messages[1].text,full);
    assert.equal(JSON.stringify(messages).includes('must not expose'),false);
    assert.deepEqual(publicMessages({}),[]);
});
