import {requiredAnimationFiles} from './ui-visual-delivery.js';
import {createHash} from 'node:crypto';
import {parse} from 'parse5';
import {z} from 'zod';

const id = z.string().min(1).max(128);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const vector = length => z.array(z.number().finite()).length(length);
const size = z.object({width:z.number().int().positive().max(16384),height:z.number().int().positive().max(16384)}).strict();
const reference = z.object({nodeId:id,componentId:id,property:id}).strict();
const component = z.object({id,type:id,properties:z.record(z.string(),z.json())}).strict();
const node = z.object({id,name:z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),parentId:id.nullable(),siblingIndex:z.number().int().nonnegative(),active:z.boolean(),localPosition:vector(3),localRotation:vector(4),localScale:vector(3),rect:z.object({anchorMin:vector(2),anchorMax:vector(2),pivot:vector(2),anchoredPosition:vector(2),sizeDelta:vector(2)}).strict(),components:z.array(component)}).strict();
const slot = z.object({slotId:id,kind:z.enum(['sprite','texture','font']),bindings:z.array(reference).min(1),deliverySize:size.optional(),imageType:z.enum(['simple','sliced']).optional(),border:z.object({left:z.number().int().nonnegative(),right:z.number().int().nonnegative(),top:z.number().int().nonnegative(),bottom:z.number().int().nonnegative()}).strict().optional(),pixelsPerUnit:z.number().positive().optional(),alphaMode:z.enum(['opaque','transparent']).optional(),generationPolicy:z.enum(['imagegen','preserve','reuse']),sourceReference:z.object({artifactId:z.uuid(),sha256:hash}).strict().optional()}).strict();
const acceptance = z.object({id,version:z.number().int().positive(),checks:z.array(id).min(1)}).strict();
const visual = z.object({id,targetNodeIds:z.array(id).min(1),resourceSlotIds:z.array(id),specification:z.record(z.string(),z.json())}).strict();
const windowSchema = z.object({sourceAnchor:z.string().regex(/^#[A-Za-z][A-Za-z0-9-]*$/).optional(),windowId:z.string().regex(/^[A-Z][A-Z0-9-]{0,31}$/),prefabPath:z.string().regex(/^Assets\/(?:[A-Za-z0-9-]+\/)*UI[A-Za-z0-9]+\.prefab$/),rootNodeId:id,referenceResolution:size,nodes:z.array(node).min(1),resourceSlots:z.array(slot),animations:z.array(visual),effects:z.array(visual),previewStates:z.array(z.object({id,activeNodes:z.record(z.string(),z.boolean())}).strict()).min(1),placeholderPolicy:z.object({image:z.literal('placeholder'),font:z.literal('default')}).strict(),styleContract:z.object({id,version:z.number().int().positive(),sha256:hash}).strict(),acceptanceProfile:z.object({whitebox:acceptance,art:acceptance,assembly:acceptance}).strict()}).strict();
export const contractSchema = z.object({schemaVersion:z.literal('ui-production-contract/1'),id:z.uuid(),version:z.number().int().positive(),projectId:z.uuid(),requirementVersionId:z.uuid(),windows:z.array(windowSchema).min(1).max(30)}).strict();
export const stages = ['prefab-whitebox','art-resources','prefab-assembly'];
export const planSchema = z.object({schemaVersion:z.literal('ui-task-plan/1'),requestId:z.uuid(),projectId:z.uuid(),requirementVersionId:z.uuid(),parentTaskId:z.uuid(),contract:z.object({id:z.uuid(),version:z.number().int().positive(),sha256:hash}).strict(),windows:z.array(z.object({windowId:id,stages:z.tuple([z.literal(stages[0]),z.literal(stages[1]),z.literal(stages[2])])}).strict()).min(1).max(30)}).strict();

// Canonical JSON is shared by registration, input generation and idempotency.
export function canonical(value)
{
    if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
    if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
    return JSON.stringify(value);
}
export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function unique(values,label)
{
    if (new Set(values).size!==values.length) throw new Error('Duplicate '+label);
}
export function validateContract(raw)
{
    const value=contractSchema.parse(raw);
    unique(value.windows.map(w=>w.windowId),'window');
    unique(value.windows.map(w=>w.prefabPath),'prefab path');
    for (const w of value.windows)
    {
        unique(w.nodes.map(n=>n.id),'node');
        unique(w.resourceSlots.map(s=>s.slotId),'slot');
        unique(w.previewStates.map(s=>s.id),'preview state');
        unique(w.animations.map(s=>s.id),'animation');
        unique(w.effects.map(s=>s.id),'effect');
        const nodes=new Map(w.nodes.map(n=>[n.id,n]));
        const roots=w.nodes.filter(n=>n.parentId===null);
        if (roots.length!==1 || roots[0].id!==w.rootNodeId) throw new Error('Invalid root');
        if (roots[0].name!==w.prefabPath.split('/').at(-1).replace('.prefab','')) throw new Error('Root name must match prefab filename');
        for (const n of w.nodes)
        {
            unique(n.components.map(c=>c.id),'component');
            const visited=new Set([n.id]);
            let parent=n.parentId;
            while (parent!==null)
            {
                if (!nodes.has(parent) || visited.has(parent)) throw new Error('Missing parent or hierarchy cycle');
                visited.add(parent);
                parent=nodes.get(parent).parentId;
            }
        }
        unique(w.nodes.filter(n=>n.parentId!==null).map(n=>n.parentId+':'+n.siblingIndex),'sibling order');
        const bindings=[];
        for (const s of w.resourceSlots)
        {
            if (s.kind!=='font' && (!s.deliverySize || !s.alphaMode)) throw new Error('Image delivery size and alpha mode required');
            if (s.kind==='sprite' && (!s.imageType || !s.pixelsPerUnit)) throw new Error('Sprite import settings required');
            if (s.imageType==='sliced' && (!s.border || s.border.left+s.border.right>=s.deliverySize.width || s.border.top+s.border.bottom>=s.deliverySize.height)) throw new Error('Invalid sliced borders');
            if (s.generationPolicy!=='imagegen' && !s.sourceReference) throw new Error('Reuse provenance required');
            for (const b of s.bindings)
            {
                const c=nodes.get(b.nodeId)?.components.find(c=>c.id===b.componentId);
                if (!c || !Object.hasOwn(c.properties,b.property)) throw new Error('Unknown resource binding');
                bindings.push(canonical(b));
            }
        }
        unique(bindings,'resource binding');
        // No hidden file references outside slots. Otherwise stale assets can
        // reappear at assembly time despite a valid Art manifest.
        function inspect(value)
        {
            if (!value || typeof value!=='object') return;
            if (Object.hasOwn(value,'assetPath') || Object.hasOwn(value,'guid')) throw new Error('Direct asset references must use declared resource slots');
            if (Object.hasOwn(value,'nodeId') && !nodes.has(value.nodeId)) throw new Error('Unknown component node reference');
            if (Object.hasOwn(value,'nodeId') && Object.hasOwn(value,'componentId') && !nodes.get(value.nodeId)?.components.some(c=>c.id===value.componentId)) throw new Error('Unknown component reference');
            for (const child of Object.values(value)) inspect(child);
        }
        for (const n of w.nodes)
        {
            for (const c of n.components)
            {
                if (!c.type.startsWith('UnityEngine.') && !['TMPro.TextMeshProUGUI','TMPro.TMP_InputField','TMPro.TMP_Dropdown'].includes(c.type)) throw new Error('Custom components require an explicit adapter, not executable code in the contract');
                inspect(c.properties);
            }
        }

        const slots=new Set(w.resourceSlots.map(s=>s.slotId));
        for (const v of [...w.animations,...w.effects])
        {
            if (v.targetNodeIds.some(id=>!nodes.has(id)) || v.resourceSlotIds.some(id=>!slots.has(id))) throw new Error('Unknown animation/effect dependency');
            if (!Object.keys(v.specification).length) throw new Error('Visual specification cannot be empty');
        }
        for (const state of w.previewStates)
        {
            if (Object.keys(state.activeNodes).some(id=>!nodes.has(id))) throw new Error('Unknown preview node');
        }
    }
    return value;
}
export function readApprovedContract(html)
{
    const found=[];
    function walk(n)
    {
        if (n.attrs?.some(a=>a.name==='id' && a.value==='ui-production-contract')) found.push(n);
        for (const child of n.childNodes ?? []) walk(child);
    }
    walk(parse(html));
    if (found.length!==1 || found[0].tagName!=='script' || !found[0].attrs.some(a=>a.name==='type' && a.value==='application/json')) throw new Error('Approved HTML must contain exactly one ui-production-contract JSON block');
    return validateContract(JSON.parse(found[0].childNodes.map(n=>n.value ?? '').join('')));
}
export function compilePlan(raw,contract)
{
    const plan=planSchema.parse(raw);
    const data=validateContract(contract);
    if (data.id!==plan.contract.id || data.version!==plan.contract.version || digest(data)!==plan.contract.sha256 || data.projectId!==plan.projectId || data.requirementVersionId!==plan.requirementVersionId) throw new Error('Contract identity/hash mismatch');
    unique(plan.windows.map(w=>w.windowId),'selected window');
    const tasks=[];
    for (const selected of plan.windows)
    {
        const w=data.windows.find(w=>w.windowId===selected.windowId);
        if (!w) throw new Error('Window not in contract');
        // Reject unsupported animation asset descriptions before publishing a plan without a producer.
        requiredAnimationFiles(w);
        for (const [index,phase] of ['whitebox','art','assembly'].entries())
        {
            const logicalId=w.windowId+'-'+phase.toUpperCase();
            const dependsOn=index===0?[]:index===1?[w.windowId+'-WHITEBOX']:[w.windowId+'-WHITEBOX',w.windowId+'-ART'];
            tasks.push({logicalId,windowId:w.windowId,type:stages[index],phase,role:phase==='art'?'Art':'Prefab',title:w.prefabPath.split('/').at(-1)+' / '+phase,dependsOn,input:{schemaVersion:'ui-task-input/1',contract:plan.contract,type:stages[index],window:w},acceptance:w.acceptanceProfile[phase]});
        }
    }
    return {plan,tasks};
}
