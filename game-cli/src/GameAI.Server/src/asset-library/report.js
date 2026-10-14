import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { search } from './index.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export async function report(pool, versionId, output)
{
    if (!/^[a-f0-9-]{36}$/.test(versionId ?? '') || !output)
    {
        throw new Error('report <version UUID> <empty output directory>');
    }
    await mkdir(output, { recursive: true });
    if ((await readdir(output)).length)
    {
        throw new Error('Report output directory must be empty.');
    }
    const { rows: [version] } = await pool.query(`SELECT v.*,t.name,t.asset_path,s.source_key FROM catalog.template_versions v
        JOIN catalog.templates t ON t.id=v.template_id JOIN catalog.sources s ON s.id=t.source_id WHERE v.id=$1`, [versionId]);
    if (!version)
    {
        throw new Error('Version not found.');
    }
    const { rows: resources } = await pool.query(`SELECT r.ref_id,rv.id,rv.descriptor,b.hash,b.bytes FROM catalog.template_resources r
        JOIN assets.resource_versions rv ON rv.id=r.resource_version_id LEFT JOIN assets.blobs b ON b.hash=rv.blob_hash WHERE r.version_id=$1 ORDER BY r.ref_id`, [versionId]);
    const { rows: jobs } = await pool.query('SELECT profile_id,status,attempts,last_error FROM search.index_jobs WHERE version_id=$1', [versionId]);
    const { rows: dependencies } = await pool.query(`SELECT d.dependency_id,t.name FROM catalog.template_dependencies d
        JOIN catalog.template_versions v ON v.id=d.dependency_id JOIN catalog.templates t ON t.id=v.template_id WHERE d.version_id=$1`, [versionId]);
    const retrieval = [];
    for (const job of jobs.filter(item => item.status === 'done'))
    {
        retrieval.push(await search(pool, job.profile_id, '登录界面，服务器选择和登录按钮'));
    }
    const images = [];
    const records = [];
    for (const resource of resources)
    {
        const descriptor = resource.descriptor;
        let image = '';
        if (resource.bytes)
        {
            if (createHash('sha256').update(resource.bytes).digest('hex') !== resource.hash)
            {
                throw new Error('Stored blob hash mismatch.');
            }
            if (['.png', '.jpg', '.jpeg'].includes(descriptor.blob?.extension))
            {
                const filename = resource.hash + descriptor.blob.extension;
                await writeFile(path.join(output, filename), resource.bytes);
                image = `<img loading="lazy" src="${filename}" alt="${escape(descriptor.assetPath ?? resource.ref_id)}">`;
                images.push(filename);
            }
        }
        records.push(`<article>${image}<p>${escape(descriptor.assetPath ?? resource.ref_id)}</p><p>${escape(descriptor.kind)} · ${escape(descriptor.status)}</p><details><summary>参数与依赖</summary><pre>${escape(JSON.stringify(descriptor, null, 2))}</pre></details></article>`);
    }
    const nodes = version.document.hierarchy.nodes;
    function tree(parent)
    {
        return '<ul>' + nodes.filter(node => node.parentId === parent).sort((a,b) => a.siblingIndex-b.siblingIndex).map(node =>
            `<li><strong>${escape(node.name)}</strong> ${node.active ? '' : '（初始隐藏）'}<span>${escape(node.components.map(component => component.type.split('.').at(-1)).join(', '))}</span>${node.rect ? `<small>尺寸偏移 ${escape(JSON.stringify(node.rect.sizeDelta))} · 锚点 ${escape(JSON.stringify(node.rect.anchorMin))} → ${escape(JSON.stringify(node.rect.anchorMax))}</small>` : ''}${tree(node.id)}</li>`).join('') + '</ul>';
    }
    const result = { success: true, versionId, name: version.name, source: version.source_key, nodeCount: nodes.length, resourceCount: resources.length, imageCount: images.length, quality: version.quality, jobs, dependencies, retrieval };
    const diagnosticCounts = {};
    for (const diagnostic of version.document.diagnostics)
    {
        diagnosticCounts[diagnostic.code] = (diagnosticCounts[diagnostic.code] ?? 0) + 1;
    }
    const labels = { 'unsupported-component': '已排除或不支持的组件', 'unresolved-resource': '布局提取阶段的外部资源引用提示（源视觉资源另行保存）', 'sv-text-presentation-adapter': 'SV 文本外观适配', 'offline-unity-validation-pending': '尚未执行 Unity 完整重建验证' };
    const content = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SV 登录 UI · 正式库首件验收</title><style>
body{margin:0;background:#edf1f5;color:#24334a;font:16px/1.65 system-ui,"Microsoft YaHei"}main{max-width:1120px;margin:auto;background:white;padding:36px}h1,h2{border-bottom:1px solid #ccd5e1;padding-bottom:12px}nav a{margin-right:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f4f7;padding:16px;font-size:13px}article{border:1px solid #ccd5e1;border-radius:10px;margin:16px 0;padding:16px;overflow-wrap:anywhere}img{max-width:100%;max-height:300px;object-fit:contain;background:repeating-conic-gradient(#ddd 0% 25%,#fff 0% 50%) 0/20px 20px}span,small{display:block;color:#607089}li{margin:8px 0}.notice{background:#fff1cf;padding:18px}@media print{main{padding:0}details{display:block}img{max-height:200px}}
</style><main><header><h1>SV 登录 UI · 正式库首件验收</h1><p>来源：${escape(version.source_key)} / ${escape(version.name)}</p><p>版本：${escape(versionId)}</p></header>
<nav><a href="#overview">入库与索引</a><a href="#tree">层级布局</a><a href="#resources">原始视觉资源</a><a href="#issues">诊断</a><a href="#raw">完整数据</a></nav>
<p class="notice">这是从服务器 PostgreSQL 读取的验收报告。下方图片是数据库中的源切图，不是重新生成的效果图。当前模板为参考级，尚未验证完整重建；风格尚未进行视觉分析。仅上传登录窗口及必要依赖，后续复杂 UI 和全库等待人工确认。</p>
<h2 id="overview">1．入库与索引</h2><p><strong>${nodes.length}</strong> 个节点 · <strong>${resources.length}</strong> 项资源 · <strong>${images.length}</strong> 张可查看原图</p><p>必要依赖：${dependencies.map(item => escape(item.name)).join('、') || '无'}。索引：${jobs.length ? jobs.map(job => `${escape(job.profile_id)} — ${escape(job.status)}`).join('；') : '尚未建立'}。</p><p>人工验收：待确认。布局及视觉完整重建：未测试。</p><details><summary>查看入库与索引技术记录</summary><pre>${escape(JSON.stringify(result,null,2))}</pre></details>
<h3>实际检索结果</h3><p>候选排序只表示相关性，不代表可以直接复用或通过验收。</p>${retrieval.map(item => `<p>查询：${escape(item.query)}</p><ol>${item.hits.map(hit => `<li>${escape(hit.name)} · 相似度 ${hit.score.toFixed(4)} · ${escape(hit.id)}</li>`).join('')}</ol>`).join('') || '<p>尚无完成的索引。</p>'}
<h2 id="tree">2．节点层级与布局</h2>${tree(null)}
<h2 id="resources">3．原始视觉资源及参数</h2>${records.join('')}
<h2 id="issues">4．排除项和未支持内容</h2><ul>${Object.entries(diagnosticCounts).map(([key,count]) => `<li>${escape(labels[key] ?? key)}：${count}</li>`).join('')}</ul><p>这些数量来自原始提取诊断；例如布局阶段的资源提示不能直接等同于数据库丢失图片。请同时核对上方已入库切图和每项资源的 status。</p><details><summary>查看全部诊断与对象位置</summary><pre>${escape(JSON.stringify(version.document.diagnostics,null,2))}</pre></details>
<h2 id="raw">5．完整数据</h2><p><a href="template.json">模板 JSON</a> · <a href="visual-evidence.json">动画与视觉证据 JSON</a> · <a href="result.json">验收摘要 JSON</a></p>
<details><summary>展开统一模板</summary><pre>${escape(JSON.stringify(version.document,null,2))}</pre></details></main></html>`;
    await writeFile(path.join(output, 'index.html'), content);
    await writeFile(path.join(output, 'template.json'), JSON.stringify(version.document,null,2));
    await writeFile(path.join(output, 'visual-evidence.json'), JSON.stringify(version.visual_evidence,null,2));
    await writeFile(path.join(output, 'result.json'), JSON.stringify(result,null,2));
    return { ...result, report: path.resolve(output, 'index.html') };
}
