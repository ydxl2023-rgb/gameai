import {prepareDesignDocument,sealDesignReview} from '../src/database/design-contract.js';
import {randomUUID} from 'node:crypto';
import {digest,stages} from '../src/database/ui-production-contract.js';
export function fixture()
{
 const profile={id:'static-ui',version:1,checks:['hierarchy','bindings','visual-preview']};
 const contract={schemaVersion:'ui-production-contract/1',id:randomUUID(),version:1,projectId:randomUUID(),requirementVersionId:randomUUID(),windows:[{
 windowId:'W01',prefabPath:'Assets/UI/Widgets/UILogin/UILogin.prefab',rootNodeId:'root',referenceResolution:{width:1920,height:1080},
 nodes:[{id:'root',name:'UILogin',parentId:null,siblingIndex:0,active:true,localPosition:[0,0,0],localRotation:[0,0,0,1],localScale:[1,1,1],rect:{anchorMin:[0,0],anchorMax:[1,1],pivot:[0.5,0.5],anchoredPosition:[0,0],sizeDelta:[0,0]},components:[{id:'image',type:'UnityEngine.UI.Image',properties:{m_Sprite:null}}]}],
 resourceSlots:[{slotId:'background',kind:'sprite',bindings:[{nodeId:'root',componentId:'image',property:'m_Sprite'}],deliverySize:{width:1920,height:1080},imageType:'simple',pixelsPerUnit:100,alphaMode:'opaque',generationPolicy:'imagegen'}],animations:[],effects:[],previewStates:[{id:'default',activeNodes:{root:true}}],placeholderPolicy:{image:'placeholder',font:'default'},styleContract:{id:'project-style',version:1,sha256:'a'.repeat(64)},acceptanceProfile:{whitebox:profile,art:profile,assembly:profile}}]};
 const plan={schemaVersion:'ui-task-plan/1',requestId:randomUUID(),projectId:contract.projectId,requirementVersionId:contract.requirementVersionId,parentTaskId:randomUUID(),contract:{id:contract.id,version:1,sha256:digest(contract)},windows:[{windowId:'W01',stages}]};
 return {contract,plan};
}

export function reviewedHtml(projectId,executionId='test-execution',threadId='test-thread')
{
 const {contract}=fixture();contract.projectId=projectId;
 const p=prepareDesignDocument({html:'<!doctype html><html><body><section id="W01"><h1>完整窗口说明</h1><p>Contract lifecycle test fixture</p></section></body></html>',spec:{...contract,schemaVersion:'ui-design-spec/1'}});
 return sealDesignReview({html:p.html,review:{passed:true,issues:[],summary:'Fixture self review',documentHash:p.documentHash,contractHash:p.contractHash,executionId,threadId}}).html;
}
