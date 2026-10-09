export interface ReadableMessage
{
    title:string;
    text:string;
    sections:{title:string;text:string}[];
    html:string;
    technical:string;
}
const labels:Record<string,string> = {preconditions:'前置条件',steps:'操作步骤',success:'成功标准',failure:'失败处理',recovery:'异常恢复',tests:'测试用例'};
const object = (value:unknown):value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const describe = (value:unknown):string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(describe).join('\n') : object(value) ? Object.entries(value).map(([key,item])=>`${labels[key] ?? key}：${describe(item)}`).join('\n') : value == null ? '' : String(value);

/** Only recognized payloads are transformed; the caller always retains the original message. */
export function parseReadableMessage(source:string):ReadableMessage | undefined
{
    const candidates:{value:Record<string,unknown>;start:number;end:number}[]=[];
    // Balanced scanning handles JSON strings containing escaped HTML and braces.
    let start=-1, depth=0, quoted=false, escaped=false;
    for(let i=0;i<source.length;i++)
    {
        const char=source[i];
        if(start<0) { if(char==='{') {start=i;depth=1;} continue; }
        if(quoted) { if(escaped) escaped=false; else if(char==='\\') escaped=true; else if(char==='"') quoted=false; continue; }
        if(char==='"') quoted=true;
        else if(char==='{') depth++;
        else if(char==='}' && --depth===0)
        {
            try { const value=JSON.parse(source.slice(start,i+1)); if(object(value)) candidates.push({value,start,end:i+1}); } catch { /* Preserve unrecognized prose. */ }
            start=-1;
        }
    }
    const candidate=candidates.find(({value:v})=>typeof v.approved_html==='string' || typeof v.html==='string' || (typeof v.task==='string' && (typeof v.description==='string' || typeof v.title==='string')) || typeof v.summary==='string');
    if(candidate)
    {
        const {value:v}=candidate;
        const sections:ReadableMessage['sections']=[];
        for(const [key,title]of [['description','任务说明'],['criteria','交付标准'],['dependencies','依赖任务'],['source_refs','需求来源'],['questions','待确认事项'],['repair','返修要求'],['retests','复测要求']])
        {
            const value=v[key];
            const text=key==='criteria' && Array.isArray(value) ? value.map(item=>object(item)?`${labels[String(item.kind)] ?? item.kind}\n${describe(item.text)}`:describe(item)).join('\n\n') : describe(value);
            if(text) sections.push({title,text});
        }
        const remainder=Object.fromEntries(Object.entries(v).filter(([key])=>!['title','task','summary','description','criteria','dependencies','source_refs','questions','repair','retests','html','approved_html'].includes(key)));
        const context=[source.slice(0,candidate.start),source.slice(candidate.end)].join('\n').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,'').trim();
        return {title:[describe(v.task),describe(v.title)].filter(Boolean).join(' · ') || '执行请求',text:describe(v.summary),sections,html:typeof v.approved_html==='string'?v.approved_html:typeof v.html==='string'?v.html:'',technical:[Object.keys(remainder).length?JSON.stringify(remainder,null,2):'',context].filter(Boolean).join('\n\n')};
    }
    const htmlStart=source.search(/<!doctype\s+html\b|<html(?:\s|>)/i);
    const htmlEnd=source.toLowerCase().lastIndexOf('</html>');
    if(htmlStart>=0 && htmlEnd>=htmlStart)
    {
        const metadata:string[]=[];
        const text=source.slice(0,htmlStart).split('\n').filter(line=>
        {
            if(/^(权威文档信息|修订|文档 SHA256)[:：]/.test(line.trim())) {metadata.push(line);return false;}
            return !/^以下是已批准的原始 HTML 数据[:：]?\s*$/.test(line.trim());
        }).join('\n').trim();
        return {title:'需求文档',text,sections:[],html:source.slice(htmlStart,htmlEnd+7),technical:[...metadata,source.slice(htmlEnd+7)].filter(Boolean).join('\n')};
    }
    return undefined;
}
