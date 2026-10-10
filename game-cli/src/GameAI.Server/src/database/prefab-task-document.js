import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from '../paths.js';

const escape = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/** Slice source bytes by parsed offsets; never summarize/rewrite the selected section. */
export function buildPrefabTaskHtml(html, task, sourceHash)
{
    if (createHash('sha256').update(html).digest('hex') !== sourceHash) throw new Error('Prefab source hash mismatch');
    const doc = parse(html, {sourceCodeLocationInfo:true});
    const nodes = [];
    function walk(node) { nodes.push(node); for (const child of node.childNodes ?? []) walk(child); }
    walk(doc);
    const idOf = node => node.attrs?.find(a => a.name === 'id')?.value;
    const anchor = /#([A-Za-z0-9_-]+)/.exec(task.source_refs?.[0] ?? '')?.[1];
    let target = anchor && nodes.find(n => idOf(n) === anchor);
    if (!target) throw new Error('Prefab task requires an exact primary source anchor: '+task.task_key);
    // Prefer the nearest semantic section; include all sibling headings/tables of this window.
    let section = target;
    while (section && section.tagName !== 'section' && section.tagName !== 'article') section = section.parentNode;
    let start;
    let end;
    if (section?.sourceCodeLocation)
    {
        start = section.sourceCodeLocation.startOffset;
        end = section.sourceCodeLocation.endOffset;
    }
    else
    {
        const position = target.sourceCodeLocation?.startOffset;
        const headings = nodes.filter(n => /^h[12]$/.test(n.tagName) && n.sourceCodeLocation);
        const heading = headings.filter(n => n.sourceCodeLocation.startOffset <= position).at(-1);
        if (!heading) throw new Error('Cannot locate complete window section: '+anchor);
        start = heading.sourceCodeLocation.startOffset;
        end = headings.find(n => n.sourceCodeLocation.startOffset > start && n.tagName <= heading.tagName)?.sourceCodeLocation.startOffset
            ?? nodes.find(n => n.tagName === 'body')?.sourceCodeLocation?.endTag?.startOffset ?? html.length;
    }
    const slice = node => html.slice(node.sourceCodeLocation.startOffset,node.sourceCodeLocation.endOffset);
    const styles = nodes.filter(n => n.tagName === 'style' && n.sourceCodeLocation).map(slice).join('\n');
    // Shared SVG definitions outside the window are required for <use> references.
    const defs = nodes.filter(n => n.tagName === 'defs' && n.sourceCodeLocation &&
        (n.sourceCodeLocation.startOffset < start || n.sourceCodeLocation.startOffset >= end)).map(slice).join('\n');
    const original = html.slice(start,end);
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><title>${escape(task.task_key)} · ${escape(task.title)}</title>${styles}</head><body><header><h1>${escape(task.task_key)} · ${escape(task.title)}</h1><p>批准需求原文摘录 · 来源 ${escape(task.source_refs[0])}</p><p>源 HTML SHA-256：${sourceHash}</p></header><svg width="0" height="0" style="position:absolute;overflow:hidden" aria-hidden="true">${defs}</svg><!-- ORIGINAL WINDOW START -->${original}<!-- ORIGINAL WINDOW END --></body></html>`;
}

/** Store the task HTML in the same publication transaction as its owning task. */
export async function storePrefabTaskHtml(client, task, html, sourceHash)
{
    const bytes = Buffer.from(buildPrefabTaskHtml(html,task,sourceHash),'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `deliveries/${task.task_key}/task-${hash}.html`;
    const artifact = (await client.query(`INSERT INTO gameai.artifacts(project_id,storage_key,sha256,byte_size,media_type,verified_at)
        VALUES($1,$2,$3,$4,'text/html',now()) ON CONFLICT(project_id,storage_key) DO UPDATE SET verified_at=gameai.artifacts.verified_at
        WHERE gameai.artifacts.sha256=EXCLUDED.sha256 RETURNING id`,[task.project_id,storageKey,hash,bytes.length])).rows[0];
    if (!artifact) throw new Error('Task document artifact conflict');
    await client.query('INSERT INTO gameai.document_contents(artifact_id,bytes) VALUES($1,$2) ON CONFLICT(artifact_id) DO NOTHING',[artifact.id,bytes]);
    await client.query(`INSERT INTO gameai.artifact_links(project_id,artifact_id,task_id)
        SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM gameai.artifact_links WHERE artifact_id=$2 AND task_id=$3)`,[task.project_id,artifact.id,task.id]);
    // The file is a readable export; database bytes remain authoritative.
    const directory = join(projectRoot,'deliveries',task.task_key);
    await mkdir(directory,{recursive:true});
    await writeFile(join(projectRoot,storageKey),bytes);
    return {artifact_id:artifact.id,path:storageKey,sha256:hash};
}
