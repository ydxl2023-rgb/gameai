import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ui-production-fixture.js';
import {validateContract,compilePlan,digest,readApprovedContract} from '../src/database/ui-production-contract.js';
test('fixed roles and dependencies, no free-form overrides',()=>{
 const {contract,plan}=fixture(); const result=compilePlan(plan,contract);
 assert.deepEqual(result.tasks.map(t=>t.role),['Prefab','Art','Prefab']);
 assert.deepEqual(result.tasks[2].dependsOn,['W01-WHITEBOX','W01-ART']);
 assert.deepEqual(result.tasks[0].input.window,contract.windows[0]);
 assert.throws(()=>compilePlan({...plan,role:'Admin'},contract));
 assert.throws(()=>compilePlan({...plan,windows:[{windowId:'W01',stages:['prefab-whitebox']}]},contract));
});
test('canonical hash binds all content',()=>{
 assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
 const {contract,plan}=fixture();contract.windows[0].nodes[0].active=false;
 assert.throws(()=>compilePlan(plan,contract),/hash/);
});
test('reject incomplete, dangling and contradictory inputs',()=>{
 const mutations=[c=>c.windows[0].nodes[0].parentId='missing',c=>c.windows[0].nodes.push(structuredClone(c.windows[0].nodes[0])),c=>c.windows[0].resourceSlots[0].bindings[0].componentId='missing',c=>delete c.windows[0].effects,c=>c.windows[0].resourceSlots[0].deliverySize=null,c=>Object.assign(c.windows[0].resourceSlots[0],{imageType:'sliced',border:{left:1920,right:0,top:0,bottom:0}}),c=>c.windows[0].effects.push({id:'fx',targetNodeIds:['missing'],resourceSlotIds:[],specification:{kind:'particle'}}),c=>c.windows[0].prefabPath='Assets/../UILogin.prefab'];
 for(const mutate of mutations){const {contract}=fixture();mutate(contract);assert.throws(()=>validateContract(contract));}
});
test('approved HTML requires exactly one contract block',()=>{
 const {contract}=fixture();const block='<script id="ui-production-contract" type="application/json">'+JSON.stringify(contract)+'</script>';
 assert.deepEqual(readApprovedContract('<html>'+block+'</html>'),contract);
 assert.throws(()=>readApprovedContract(block+block));assert.throws(()=>readApprovedContract('<html/>'));
});

test('legacy asset paths and unsupported custom components cannot bypass slots',()=>
{
    const {contract}=fixture();
    contract.windows[0].nodes[0].components[0].properties.m_Sprite={assetPath:'Assets/Old.png'};
    assert.throws(()=>validateContract(contract),/Direct asset/);
    contract.windows[0].nodes[0].components[0].properties.m_Sprite=null;
    contract.windows[0].nodes[0].components[0].type='Game.BusinessLogin';
    assert.throws(()=>validateContract(contract),/Custom components/);
});
