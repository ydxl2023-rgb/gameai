import test from 'node:test';
import assert from 'node:assert/strict';
import {publishTaskResponse,recoverTaskPublications} from '../src/track/task-publication.js';
import {drainWorkflowOutbox} from '../src/track/workflow-outbox.js';
import {recoveryDecision} from '../src/database/task-recovery.js';
import {hasPublicationProof} from '../src/database/publication-proof.js';
import {recoverPmPublications} from '../src/track/pm-publication.js';

test('PM recovery publishes saved plan without invoking PM again',async()=>
{
    const result={execution_id:'pm',plan:{tasks:[]}};
    const f=fixture([{id:'job',execution_id:'pm',project_key:'DEMO',publication_result:result}]);
    let calls=0;
    await recoverPmPublications(f.pool,async(_p,key,job,output,options)=>
    {
        calls++;
        assert.equal(key,'DEMO');
        assert.deepEqual(output,result);
        assert.equal(options.recoverPublication,true);
    });
    assert.equal(calls,1);
    assert.match(f.queries[0].sql,/j.recover_publication/);
    assert.match(f.queries[0].sql,/r.state='completed'/);
    assert.match(f.queries[0].sql,/publication_attempts<5/);
});

test('late publication cannot authorize late or unconfirmed execution',()=>
{
    const lease={expires_at:'2026-10-19T01:00:00Z'};
    const proof={state:'completed',finished_at:'2026-10-19T00:59:00Z'};
    const now=new Date('2026-10-19T02:00:00Z');
    assert.equal(hasPublicationProof(proof,lease,true,now),true);
    assert.equal(hasPublicationProof(proof,lease,false,now),false);
    assert.equal(hasPublicationProof({...proof,state:'unknown'},lease,true,now),false);
    assert.equal(hasPublicationProof({...proof,finished_at:'2026-10-19T01:01:00Z'},lease,true,now),false);
    assert.equal(hasPublicationProof({...proof,finished_at:null},lease,true,now),false);
});

function fixture(rows=[])
{
    const queries=[];
    return {queries,pool:{async query(sql,args)
    {
        queries.push({sql,args});
        return {rows:sql.startsWith('SELECT')?rows:[],rowCount:1};
    }}};
}

test('database publication failure schedules publication only; later recovery reuses exact output',async()=>
{
    const job={executionId:'test-recovery'};
    const response={result:{Text:'original output'},error:null};
    const f=fixture([{execution_id:job.executionId,job,response,execution_state:'running'}]);
    let attempts=0;
    const finish=async(_pool,j,r)=>
    {
        assert.deepEqual(j,job);
        assert.deepEqual(r,response);
        if (++attempts===1) throw new Error('database unavailable');
    };
    await assert.rejects(publishTaskResponse(f.pool,job,response,finish),/unavailable/);
    assert.ok(f.queries.some(q=>q.sql.includes('attempts=attempts+1')));
    await recoverTaskPublications(f.pool,finish);
    assert.equal(attempts,2);
    assert.ok(f.queries.some(q=>q.sql.includes("state='published'")));
});

test('duplicate publication notifications do not concurrently finalize the same execution',async()=>
{
    const f=fixture();
    let release;
    const wait=new Promise(resolve=>{release=resolve;});
    let calls=0;
    const finish=async()=>{calls++;await wait;};
    const first=publishTaskResponse(f.pool,{executionId:'duplicate'}, {},finish);
    await publishTaskResponse(f.pool,{executionId:'duplicate'}, {},finish);
    release();
    await first;
    assert.equal(calls,1);
});

test('restart after transaction commit acknowledges response without reapplying it',async()=>
{
    const f=fixture([{execution_id:'finished',execution_state:'succeeded'}]);
    await recoverTaskPublications(f.pool,async()=>assert.fail('must not replay terminal execution'));
    assert.ok(f.queries.some(q=>q.sql.includes("state='published'")));
});

test('restart imports spooled response but missing output never starts a new Agent',async()=>
{
    const job={executionId:'spooled'};
    const f=fixture([{execution_id:'spooled',job,execution_state:'running',response:null}]);
    let calls=0;
    await recoverTaskPublications(f.pool,async(_p,_j,r)=>{calls++;assert.equal(r.result.Text,'blocked output');},async()=>JSON.stringify({result:{Text:'blocked output'}}));
    assert.equal(calls,1);
    await recoverTaskPublications(f.pool,async()=>assert.fail('no output'),async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});});
});

test('completion notification is retained if scheduling fails',async()=>
{
    const f=fixture([{event_key:'event',plan_version_id:'plan'}]);
    await assert.rejects(drainWorkflowOutbox(f.pool,async()=>{throw new Error('offline');}),/offline/);
    assert.equal(f.queries.filter(q=>q.sql.startsWith('UPDATE')).length,0);
    await drainWorkflowOutbox(f.pool,async(_p,id)=>assert.equal(id,'plan'));
    assert.equal(f.queries.filter(q=>q.sql.startsWith('UPDATE')).length,1);
});

test('device waits, approval changes and uncertain processes remain explicit non-retry states',()=>
{
    const base={state:'failed',attempts:1,authorized:true};
    for (const [error,code] of [['需要真机验收','awaiting_device'],['需求版本改变','awaiting_decision'],['上游改变','awaiting_dependency']])
    {
        const result=recoveryDecision({...base,error});
        assert.equal(result.code,code);
        assert.equal(result.retry,false);
    }
    assert.equal(recoveryDecision({...base,state:'unknown'}).code,'process_unconfirmed');
});
