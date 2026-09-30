/** Select source figures in their original logical order, never execute source markup. */
export function taskWireframes(html: string, references: string[])
{
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const figures = Array.from(doc.querySelectorAll('figure')).filter(f => f.querySelector('svg,img'));
    // The first reference identifies this task's deliverable; later references are context.
    // Never broaden an exact anchor match using component names repeated across pages.
    const anchors = Array.from((references[0] ?? '').matchAll(/#([A-Za-z0-9_-]+)/g), m => m[1]);
    const matched: Element[] = [];
    for (const id of anchors)
    {
        const target = doc.getElementById(id);
        if (!target) continue;
        const visual = target.closest('figure') ?? (target.querySelector('svg,img') ? target : null);
        if (visual && !matched.includes(visual)) matched.push(visual);
    }
    const selected = matched.length ? matched : figures;
    if (!selected.length) return {html:'', fallback:false, count:0};
    const output = doc.implementation.createHTMLDocument('任务线框');
    doc.querySelectorAll('style').forEach(style => output.head.append(style.cloneNode(true)));
    // Inline <use> and clip-path nodes may depend on shared definitions outside the selected figure.
    const definitions = doc.querySelector('svg.svg-definitions');
    if (definitions) output.body.append(definitions.cloneNode(true));
    selected.forEach(f => output.body.append(f.cloneNode(true)));
    // Strip active content, external resources and document navigation from the isolated reader.
    output.querySelectorAll('script,iframe,object,embed,foreignObject,link,meta,base,form').forEach(node => node.remove());
    output.querySelectorAll('*').forEach(node => {
        Array.from(node.attributes).forEach(a => {
            if (/^on/i.test(a.name) || ['href','src','xlink:href'].includes(a.name) && !a.value.startsWith('#') && !a.value.startsWith('data:image/')) node.removeAttribute(a.name);
        });
    });
    const layout = output.createElement('style');
    layout.textContent = 'html,body{margin:0;padding:0;background:#fff}body{padding:12px}figure{display:block!important;width:100%!important;margin:0 0 20px!important;break-inside:avoid}svg,img{max-width:100%;height:auto}';
    output.head.append(layout);
    return {html:output.documentElement.outerHTML, fallback:!matched.length, count:selected.length};
}

export function taskDescription(text = '')
{
    const details:string[] = [];
    const delivery:string[] = [];
    for (const line of text.split(/\r?\n/).filter(line => line.trim()))
    {
        (/^(交付物|交付内容|完成条件|完成门禁)[:：]/.test(line.trim()) ? delivery : details).push(line);
    }
    return {details, delivery};
}
