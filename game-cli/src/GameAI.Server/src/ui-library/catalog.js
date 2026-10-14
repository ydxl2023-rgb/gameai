import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const categories = [
    ['dialog', ['提示', '确认', '弹窗', 'dialog', 'tips', 'confirm', 'toast']],
    ['login', ['登录', 'login']], ['shop', ['商店', '商城', 'shop', 'store']],
    ['inventory', ['背包', 'inventory', 'bag']], ['reward', ['奖励', 'reward']],
];

export function summarize(row)
{
    const nodes = row.document.prefab.nodes;
    const text = `${row.name} ${row.asset_path}`.toLowerCase();
    const category = categories.find(([, words]) => words.some(word => text.includes(word)))?.[0] ?? 'unclassified';
    const components = nodes.flatMap(node => node.components.map(component => ({ node, component })));
    const buttons = components.filter(item => item.component.type === 'UnityEngine.UI.Button').map(item => item.node.name);
    const scrolls = components.filter(item => item.component.type === 'UnityEngine.UI.ScrollRect').map(({ component }) => ({ horizontal: [true, 1, "1"].includes(component.properties.m_Horizontal), vertical: [true, 1, "1"].includes(component.properties.m_Vertical) }));
    const root = nodes.find(node => node.id === row.document.prefab.rootNodeId);
    const missing = (row.visual_resources ?? []).filter(resource => ['unresolved', 'parse-failed', 'adapter-required', 'analysis-required'].includes(resource.status));
    return {
        category, classification: 'name/path heuristic; review before use', nodeCount: nodes.length,
        buttons, scrolls, layouts: [...new Set(components.filter(item => /LayoutGroup$/.test(item.component.type)).map(item => item.component.type.split('.').at(-1)))],
        rootRect: root?.rect ?? null, hierarchy: nodes.slice(0, 40).map(node => ({ id: node.id, parentId: node.parentId, name: node.name, active: node.active })),
        visualResourceCount: row.visual_resources?.length ?? 0, missingResourceCount: missing.length,
        visualEvidence: Boolean(row.has_visual), grade: row.grade,
        limitations: [...new Set((row.diagnostics ?? []).map(item => item.code))],
        readiness: !row.has_visual ? 'no-visual-evidence' : missing.length ? 'adaptation-required' : 'requires-restore-preflight',
    };
}

export function score(summary, query, name = '')
{
    const lower = query.toLowerCase();
    const reasons = [];
    let value = 0;
    const wanted = categories.filter(([, words]) => words.some(word => lower.includes(word))).map(([category]) => category);
    if (wanted.length && !wanted.includes(summary.category)) return { score: 0, reasons: [] };
    if (wanted.length && wanted.includes(summary.category)) { value += 10; reasons.push('功能分类匹配'); }
    if (/按钮|button/.test(lower) && summary.buttons.length) { value += 3; reasons.push(`包含 ${summary.buttons.length} 个按钮`); }
    if (/关闭|close/.test(lower) && summary.buttons.some(name => /close|关闭/i.test(name))) { value += 4; reasons.push('含关闭按钮'); }
    if (/确认|确定|confirm/.test(lower) && summary.buttons.some(name => /confir|确定/i.test(name))) { value += 4; reasons.push('含确认按钮'); }
    if (/横向|horizontal/.test(lower) && summary.scrolls.some(item => item.horizontal)) { value += 4; reasons.push('横向滚动结构'); }
    if (/纵向|vertical/.test(lower) && summary.scrolls.some(item => item.vertical)) { value += 4; reasons.push('纵向滚动结构'); }
    if (/列表|滚动|scroll|list/.test(lower) && summary.scrolls.length) { value += 2; reasons.push('包含滚动列表'); }
    for (const token of lower.split(/\s+/).filter(token => token.length > 1))
    {
        if (name.toLowerCase().includes(token)) { value += 5; reasons.push('名称匹配'); }
    }
    return { score: value, reasons: [...new Set(reasons)] };
}

export async function searchTemplates(pool, query, output)
{
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Query must contain 1..500 characters');
    // One latest immutable version per template; no duplicate historical candidates.
    const { rows } = await pool.query(`SELECT DISTINCT ON(t.id) v.id AS version_id,t.name,t.asset_path,t.source_key,v.document,v.diagnostics,v.grade,
        EXISTS(SELECT 1 FROM ui_library.visual_bindings b WHERE b.version_id=v.id) AS has_visual,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('status',r.descriptor->>'status')) FROM ui_library.visual_resources r WHERE r.version_id=v.id),'[]'::jsonb) AS visual_resources
        FROM ui_library.templates t JOIN ui_library.versions v ON v.template_id=t.id ORDER BY t.id,v.id DESC`);
    const candidates = [];
    for (const row of rows)
    {
        const summary = summarize(row);
        await pool.query(`INSERT INTO ui_library.catalog(version_id,index_version,summary) VALUES($1,1,$2)
            ON CONFLICT(version_id) DO UPDATE SET summary=excluded.summary,index_version=1,updated_at=now()`, [row.version_id, summary]);
        const ranked = score(summary, query, row.name);
        if (ranked.score > 0) candidates.push({ versionId: row.version_id, name: row.name, source: row.source_key, assetPath: row.asset_path, ...ranked, ...summary });
    }
    candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || Number(b.versionId) - Number(a.versionId));
    const selected = candidates.slice(0, 10);
    for (const candidate of selected)
    {
        const { rows: [preview] } = await pool.query('SELECT image FROM ui_library.previews WHERE version_id=$1', [candidate.versionId]);
        candidate.previewAvailable = Boolean(preview);
        if (preview) candidate.preview = 'data:image/png;base64,' + preview.image.toString('base64');
    }
    const result = { success: true, query, indexed: rows.length, matched: candidates.length, candidates: selected, nextStep: 'Choose a versionId, then run ui-library restore. Search never starts Unity or Track.' };
    if (output)
    {
        await mkdir(output, { recursive: true });
        const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
        const cards = selected.map(item => `<article><h2>${escape(item.name)} · 版本 ${escape(item.versionId)}</h2>${item.preview ? `<img src="${item.preview}">` : '<p>尚无该版本的 Unity 预览</p>'}<p>分类：${escape(item.category)}（名称/路径推断） · 得分 ${item.score}</p><p>${escape(item.reasons.join('；'))}</p><p>${item.nodeCount} 节点 / ${item.buttons.length} 按钮 / ${item.scrolls.length} 滚动列表 / ${item.missingResourceCount} 资源适配项</p><p>状态：${escape(item.readiness)}。需执行重建预检查。</p><details><summary>层级与限制</summary><pre>${escape(JSON.stringify({ hierarchy: item.hierarchy, limitations: item.limitations }, null, 2))}</pre></details><code>GameCLI ui-library restore --version ${escape(item.versionId)} --server &lt;server&gt; --project &lt;unity&gt; --output &lt;新目录&gt;</code></article>`).join('');
        await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>UI 模板候选</title><style>body{font:16px/1.7 sans-serif;background:#f3f4f6;max-width:1100px;margin:30px auto}article,header{padding:24px;background:white;margin:20px 0}img{max-width:100%}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}</style><header><h1>UI 模板候选</h1><p>${escape(query)}</p><p>先比较结构和限制，再选择版本进行重建。候选得分不是视觉相似度。</p></header>${cards || '<p>没有匹配的模板；请调整查询或导入更多模板。</p>'}</html>`);
        await writeFile(path.join(output, 'candidates.json'), JSON.stringify(result, null, 2));
    }
    return { ...result, candidates: selected.map(({ preview, ...item }) => item) };
}

export async function registerPreview(pool, versionId, file)
{
    if (!/^[1-9][0-9]*$/.test(versionId)) throw new Error('Invalid version ID');
    const bytes = await readFile(file);
    if (bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Expected PNG up to 16 MiB');
    await pool.query('INSERT INTO ui_library.previews(version_id,image) VALUES($1,$2) ON CONFLICT(version_id) DO UPDATE SET image=excluded.image,created_at=now()', [versionId, bytes]);
    return { success: true, versionId };
}
