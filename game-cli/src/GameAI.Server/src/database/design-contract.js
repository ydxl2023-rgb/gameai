import {prepareUiDocumentPrompt} from './ui-document-prompt.js';
import {preserveUiTemplateContext,validateUiTemplateGuardContext} from './ui-template-context.js';
import {parse} from 'parse5';
import {z} from 'zod';
import {contractSchema,validateContract,readApprovedContract,digest} from './ui-production-contract.js';

const specSchema=contractSchema.omit({schemaVersion:true}).extend({schemaVersion:z.literal('ui-design-spec/1')}).strict();
const reviewSchema=z.object({passed:z.literal(true),issues:z.array(z.string()).max(0),summary:z.string().trim().min(1),documentHash:z.string().regex(/^[a-f0-9]{64}$/),contractHash:z.string().regex(/^[a-f0-9]{64}$/),executionId:z.string().min(1),threadId:z.string().min(1)}).strict();
function elements(html,id)
{
    const found=[];
    function walk(n)
    {
        if(n.attrs?.some(a=>a.name==='id' && a.value===id)) found.push(n);
        for(const child of n.childNodes ?? []) walk(child);
    }
    walk(parse(html,{sourceCodeLocationInfo:true}));
    return found;
}
function append(html,id,value)
{
    if(elements(html,id).length) throw Error('Duplicate document block: '+id);
    if(!/<\/body\s*>/i.test(html)) throw Error('Complete HTML body required');
    const json=JSON.stringify(value).replace(/</g,'\\u003c');
    return html.replace(/<\/body\s*>/i,()=>`<script id="${id}" type="application/json">${json}</script></body>`);
}
export function generateContract(raw)
{
    const spec=specSchema.parse(raw);
    return validateContract({...spec,schemaVersion:'ui-production-contract/1'});
}
export function buildProductionSkeleton(html,version)
{
    const contract=readApprovedContract(html);
    const tasks=[];
    const sections=[];
    for(const w of contract.windows)
    {
        const anchor=w.sourceAnchor ?? '#'+w.windowId;
        const nodes=elements(html,anchor.slice(1));
        if(nodes.length!==1 || !['section','article'].includes(nodes[0].tagName)) throw Error('Window requires one complete visible section: '+anchor);
        const location=nodes[0].sourceCodeLocation;
        if(sections.some(s=>!(location.endOffset<=s.startOffset || location.startOffset>=s.endOffset))) throw Error('Window sections overlap');
        sections.push(location);
        for(const phase of ['whitebox','art','assembly'])
        {
            const id=w.windowId+'-'+phase.toUpperCase();
            tasks.push({id,window_id:w.windowId,phase,role:phase==='art'?'Art':'Prefab',source_refs:[anchor],prefab_name:w.prefabPath.split('/').at(-1),depends_on:phase==='whitebox'?[]:phase==='art'?[w.windowId+'-WHITEBOX']:[w.windowId+'-WHITEBOX',w.windowId+'-ART']});
        }
    }
    return {schema_version:1,requirement_version:version,scope:'ui-only',tasks};
}
export function prepareDesignDocument({html,spec,sourceHtml})
{
    if(elements(html,'design-contract-review').length || elements(html,'ui-delivery-manifest').length) throw Error('Remove stale review and legacy delivery manifest before preparing the document');
    if (sourceHtml) html=preserveUiTemplateContext(sourceHtml,html);
    validateUiTemplateGuardContext(html);
    const contract=generateContract(spec);
    const prepared=append(html,'ui-production-contract',contract);
    buildProductionSkeleton(prepared,'draft');
    return {html:prepared,reviewHtml:prepareUiDocumentPrompt(prepared),contract,contractHash:digest(contract),documentHash:digest(prepared)};
}
export function sealDesignReview({html,review})
{
    const parsed=reviewSchema.parse(review);
    if(parsed.documentHash!==digest(html) || parsed.contractHash!==digest(readApprovedContract(html))) throw Error('Design review does not match document/contract');
    buildProductionSkeleton(html,'review');
    return {html:append(html,'design-contract-review',parsed)};
}
export function validateDesignDocument(html,expected={})
{
    const contract=readApprovedContract(html);
    const nodes=elements(html,'design-contract-review');
    if(nodes.length!==1 || nodes[0].tagName!=='script' || !nodes[0].attrs.some(a=>a.name==='type' && a.value==='application/json')) throw Error('Design self-review required before submission/approval');
    const review=reviewSchema.parse(JSON.parse(nodes[0].childNodes.map(n=>n.value ?? '').join('')));
    const location=nodes[0].sourceCodeLocation;
    const unsigned=html.slice(0,location.startOffset)+html.slice(location.endOffset);
    if(review.documentHash!==digest(unsigned) || review.contractHash!==digest(contract)) throw Error('Document changed after Design review');
    if(expected.projectId && contract.projectId!==expected.projectId) throw Error('Contract project mismatch');
    if(expected.versionId && contract.requirementVersionId!==expected.versionId) throw Error('Contract requirement version mismatch');
    if(expected.executionId && review.executionId!==expected.executionId) throw Error('Design review execution mismatch');
    if(expected.threadId && review.threadId!==expected.threadId) throw Error('Design review thread mismatch');
    buildProductionSkeleton(html,'approved');
    return {contract,review};
}
