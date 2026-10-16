import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowPump} from '../src/track/workflow-pump.js';

test('overlapping ticks do not duplicate a run or starve another lane',async()=>
{
    let release;
    const wait=new Promise(resolve=>{release=resolve;});
    let tasks=0;
    let approvals=0;
    const pump=createWorkflowPump({tasks:async()=>{tasks++;await wait;},approvals:async()=>{approvals++;}},assert.fail);
    const first=pump();
    await Promise.resolve();
    await pump();
    await pump();
    assert.equal(tasks,1);
    assert.equal(approvals,3);
    release();
    await first;
    await pump();
    assert.equal(tasks,2);
});

test('transient scheduler failure is retried on the next tick',async()=>
{
    let attempts=0;
    const errors=[];
    const pump=createWorkflowPump({tasks:async()=>{if(++attempts===1)throw new Error('database unavailable');}},(name,error)=>errors.push([name,error.message]));
    await pump();
    await pump();
    assert.equal(attempts,2);
    assert.deepEqual(errors,[['tasks','database unavailable']]);
});
