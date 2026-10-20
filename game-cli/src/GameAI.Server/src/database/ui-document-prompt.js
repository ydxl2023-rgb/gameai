import {createHash} from 'node:crypto';
import {parse} from 'parse5';
import {readUiTemplateContext} from './ui-template-context.js';

// Intern repeated JSON objects, not summaries. Every value remains available to the reader.
export function packContext(payload)
{
    function identity(value)
    {
        if (Array.isArray(value)) return '['+value.map(identity).join(',')+']';
        if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+identity(value[key])).join(',')+'}';
        return JSON.stringify(value);
    }
    const counts = new Map();
    function count(value)
    {
        if (!value || !['object','string'].includes(typeof value)) return;
        if (!Array.isArray(value) && Object.hasOwn(value,'$contextRef')) throw new Error('Reserved context reference key.');
        const text = identity(value);
        if (text.length > 128) counts.set(text,(counts.get(text) ?? 0)+1);
        if (typeof value==='object') for (const child of Object.values(value)) count(child);
    }
    count(payload);
    const definitions = {};
    const identities = new Map();
    function contents(value)
    {
        return Array.isArray(value) ? value.map(convert) : Object.fromEntries(Object.entries(value).map(([key,child])=>[key,convert(child)]));
    }
    function convert(value)
    {
        if (!value || !['object','string'].includes(typeof value)) return value;
        const text = identity(value);
        if (counts.get(text) > 1)
        {
            if (identities.has(text)) return {$contextRef:identities.get(text)};
            const id = 'D'+(identities.size+1);
            identities.set(text,id);
            definitions[id] = typeof value==='string' ? value : contents(value);
            return {$contextRef:id};
        }
        return typeof value==='string' ? value : contents(value);
    }
    const data = convert(payload);
    return {encoding:'json-object-references-v1',definitions,data};
}

export function prepareUiDocumentPrompt(html, documentReference = null)
{
    const context = readUiTemplateContext(html);
    if (!context) return html;
    let location;
    function walk(node)
    {
        if (node.attrs?.some(a=>a.name==='id' && a.value==='ui-template-context')) location=node.sourceCodeLocation;
        for (const child of node.childNodes ?? []) walk(child);
    }
    walk(parse(html,{sourceCodeLocationInfo:true}));
    if (documentReference)
    {
        if (!documentReference.path || !documentReference.sha256) throw new Error('Missing immutable document reference.');
        return html.slice(0,location.startOffset)+'<!-- ui-template-context: retained in immutable approved file -->'+html.slice(location.endOffset)+
            '\n完整附件保存在已核验的本地批准文档：'+JSON.stringify(documentReference)+
            '\n附件 SHA256='+context.sha256+'。使用脚本解析该文件中 id=ui-template-context 的 JSON；按节点、属性或资源类别分批读取。不得把整份 HTML、assembly、baseline、snapshot 或授权 changes 打印到对话。生产命令直接消费完整文件，禁止删减数据；诊断只输出计数、哈希和差异。';
    }
    // Preserve the authoritative raw text in HTML; the review transport carries all
    // parsed baseline values plus the raw-byte identity, avoiding escaped JSON duplication.
    const payload = structuredClone(context.payload);
    if (typeof payload.guardBaselineJson === 'string')
    {
        payload.guardBaselineJson = {
            encoding:'parsed-json-with-raw-sha256',
            rawSha256:createHash('sha256').update(payload.guardBaselineJson,'utf8').digest('hex'),
            value:JSON.parse(payload.guardBaselineJson)
        };
    }
    // Guard envelopes repeat complete JSON documents as escaped strings. Carry
    // their parsed values and raw identities so object interning can deduplicate
    // them too; the source HTML still owns every original byte.
    function packRawDocuments(value)
    {
        if (!value || typeof value!=='object') return;
        for (const [key,child] of Object.entries(value))
        {
            if (typeof child==='string' && ['baselineJson','snapshotJson','approvalJson','guardApprovalJson'].includes(key))
            {
                value[key]={encoding:'parsed-json-with-raw-sha256',rawSha256:createHash('sha256').update(child,'utf8').digest('hex'),value:JSON.parse(child)};
            }
            else packRawDocuments(child);
        }
    }
    packRawDocuments(payload);
    const body = html.slice(0,location.startOffset)+'<!-- ui-template-context: complete lossless payload follows below -->'+html.slice(location.endOffset);
    return body+'\n\n完整 ui-template-context 附件（无损传输表示，不是摘要）：原附件 SHA256='+context.sha256+
        '\n以下 JSON 的 data 为完整 payload；遇到唯一字段 {$contextRef:"D编号"} 时，读取 definitions 对应编号的完整值，可递归引用。所有数据值均已包含，不需要访问附件地址或重新检索。guardBaselineJson如标记parsed-json-with-raw-sha256，则value是其完整JSON值，rawSha256是原始文本字节哈希；只省略文本缩进与转义写法，原始字符串仍完整保存在正式HTML。重复值仅存储一次，节点、属性、授权差异、资源和动画命令没有删除。数据库原始HTML保持不变，批准哈希始终针对原始HTML。修订输出无需重抄附件，宿主会原样保留。\n'+JSON.stringify(packContext(payload));
}
