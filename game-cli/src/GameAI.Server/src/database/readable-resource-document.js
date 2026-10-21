import {parse} from 'parse5';

// Patch visible text only. Frozen contracts, source attachments and links retain their exact bytes.
export function readableResourceDocument(html, aliases, {notice = true} = {})
{
    const document = parse(html, {sourceCodeLocationInfo: true});
    const edits = [];
    const targets = new Map();
    for (const alias of aliases)
    {
        const from = alias.from.split('/').at(-1);
        if (!targets.has(from)) targets.set(from, new Set());
        targets.get(from).add(alias.to.split('/').at(-1));
    }
    function visit(node)
    {
        if (['script', 'style', 'template'].includes(node.tagName)) return;
        if (node.nodeName === '#text' && node.sourceCodeLocation)
        {
            const {startOffset, endOffset} = node.sourceCodeLocation;
            const original = html.slice(startOffset, endOffset);
            let value = original;
            for (const alias of aliases)
            {
                const from = alias.from.split('/').at(-1);
                const to = alias.to.split('/').at(-1);
                if (!/^[a-f0-9]{64}\.(png|ttf|otf|ttc)$/.test(from) || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(to) || targets.get(from).size !== 1) continue;
                value = value.replaceAll(from, to);
            }
            if (value !== original) edits.push({startOffset, endOffset, value});
        }
        for (const child of node.childNodes ?? []) visit(child);
    }
    visit(document);
    for (const edit of edits.sort((a, b) => b.startOffset - a.startOffset))
    {
        html = html.slice(0, edit.startOffset) + edit.value + html.slice(edit.endOffset);
    }
    if (notice && edits.length)
    {
        const banner = '<aside style="padding:12px;border:1px solid #b42318;color:#b42318">资源名称阅读版：仅调整可见资源名称；已审批原件及内嵌机器契约保持原样。本副本不替代正式审批版本。</aside>';
        html = html.replace(/<body\b[^>]*>/i, match => match + banner);
    }
    return {html, changedTextNodes: edits.length};
}

export function encodedResourceNames(html)
{
    const names = new Set();
    function visit(node)
    {
        // Provenance is explicitly separated from the reader's resource inventory.
        if (['script','style','template'].includes(node.tagName) || node.attrs?.some(a=>a.name==='data-resource-provenance')) return;
        if (node.nodeName === '#text')
        {
            for (const match of node.value.matchAll(/\b[a-f0-9]{64}\.(?:png|jpe?g|webp|ttf|otf|ttc)\b/gi)) names.add(match[0]);
        }
        for (const child of node.childNodes ?? []) visit(child);
    }
    visit(parse(html));
    return [...names];
}
