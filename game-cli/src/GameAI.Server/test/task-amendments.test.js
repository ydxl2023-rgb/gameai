import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAmendment,authorizeTaskAmendment} from '../src/database/task-amendments.js';
import {digest} from '../src/database/ui-production-contract.js';

const input={type:'prefab-assembly',window:{nodes:[{id:'panel',rect:{anchoredPosition:[0,0]},components:[{id:'canvas',type:'UnityEngine.Canvas',properties:{}},{id:'mask',type:'UnityEngine.UI.Image',properties:{m_RaycastTarget:0}}]}]}};
const amendment={baseHash:digest(input),reason:'Fix input and safe area',authorizationReference:'Explicit user approval',evidenceDirectory:'deliveries/F-1/repair',simulation:{id:'synthetic-v1',width:1920,height:1080,safeArea:[80,40,1760,1040]},patches:[{kind:'position',nodeId:'panel',before:[0,0],after:[-80,60]},{kind:'raycast',nodeId:'panel',componentId:'mask',before:0,after:1},{kind:'raycaster',nodeId:'panel',componentId:'raycaster'}]};
test('amendments preserve the immutable baseline and retain explicit authority',()=>
{
    const before=structuredClone(input);
    const result=applyAmendment(input,amendment);
    assert.deepEqual(input,before);
    assert.deepEqual(result.window.nodes[0].rect.anchoredPosition,[-80,60]);
    assert.equal(result.window.nodes[0].components[1].properties.m_RaycastTarget,1);
    assert.equal(result.window.nodes[0].components.at(-1).type,'UnityEngine.UI.GraphicRaycaster');
    assert.deepEqual(result.taskAmendments,[amendment]);
});
test('stale, duplicate, unsupported and out-of-bounds amendments fail closed',()=>
{
    for (const raw of [{...amendment,baseHash:'0'.repeat(64)},{...amendment,patches:[...amendment.patches,amendment.patches[0]]},{...amendment,simulation:{...amendment.simulation,safeArea:[80,40,1920,1080]}},{...amendment,patches:[{...amendment.patches[0],before:[1,0]}]},{...amendment,patches:[{kind:'remove-node',nodeId:'panel'}]}])
    {
        assert.throws(()=>applyAmendment(input,raw));
    }
    assert.throws(()=>applyAmendment({...input,type:'art-resources'},amendment));
});

test('unauthorized amendment transaction rolls back before writes',async()=>
{
    const statements=[];
    let released=false;
    const pool={connect:async()=>({query:async(sql)=>
    {
        statements.push(sql);
        if (sql==='SELECT * FROM gameai.tasks WHERE id=$1') return {rows:[{project_id:'project'}]};
        return {rows:[],rowCount:0};
    },release(){released=true;}})};
    await assert.rejects(authorizeTaskAmendment(pool,'task','unauthorized-user',amendment),/权限/);
    assert.equal(statements.at(-1),'ROLLBACK');
    assert.equal(statements.some(sql=>/^INSERT|^UPDATE/.test(sql)),false);
    assert.equal(released,true);
});
