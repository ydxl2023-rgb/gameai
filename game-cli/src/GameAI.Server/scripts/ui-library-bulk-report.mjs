import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {loadEnvFile} from 'node:process';
import path from 'node:path';
loadEnvFile(new URL('../.env.workflow',import.meta.url));
const {createPool}=await import('../src/database/connection.js');
const pool=createPool();
const base=process.argv[2];const out=process.argv[3];
const inventory=JSON.parse(await readFile(path.join(base,'source-inventory.json'),'utf8'));
const {rows}=await pool.query("select source_guid,name,asset_path from ui_library.templates where source_key='sv'");
const known=new Set(rows.map(r=>r.source_guid));const errors=new Map();
for(const dir of await readdir(base,{withFileTypes:true})){
 if(!dir.isDirectory()||(!/^batch-\d+$/.test(dir.name)&&!/^single-\d+$/.test(dir.name)))continue;
 for(const f of ['report.json','import-result.json']){
  try{const report=JSON.parse(await readFile(path.join(base,dir.name,f),'utf8'));for(const item of [...(report.failures??[]),...(report.rejected??[])]) errors.set(item.assetPath,item.error);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
const missing=inventory.filter(i=>!known.has(i.guid)).map(i=>({...i,error:errors.get(i.path.replaceAll('\\','/').replace('G:/Works/SV/Development/Project/',''))??'Batch not completed or source dependency rejected'}));
const stats=await pool.query("select count(distinct r.resource_id) as visual_resources,count(distinct r.blob_hash) as binaries from ui_library.visual_resources r join ui_library.versions v on v.id=r.version_id join ui_library.templates t on t.id=v.template_id where t.source_key='sv'");
const result={sourceCount:inventory.length,indexedSourceCount:inventory.length-missing.length,missingCount:missing.length,totalSvTemplates:rows.length,...stats.rows[0],missing};
await mkdir(out,{recursive:true});await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
await writeFile(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>SV 全量导入核对</title><style>body{font:16px/1.7 sans-serif;max-width:1100px;margin:30px auto}td,th{border:1px solid #ddd;padding:8px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}</style><h1>SV 全量导入核对</h1><p>2026-10-13 · 源目录只读 · 未走 Track</p><p>源预制 ${result.sourceCount}，已入库 ${result.indexedSourceCount}，未入库 ${result.missingCount}。含目录外依赖共 ${result.totalSvTemplates} 个 SV 模板。视觉资源 ${result.visual_resources}，唯一二进制 ${result.binaries}。</p><p>入库保存 reference-only 等适配状态，不代表已通过 Unity 完整重建。批次导出、校验、事务导入分别留存；失败批次中的合格依赖闭包显式选入 accepted-manifest.json，原始失败清单保留。</p><h2>未入库清单</h2><table><tr><th>文件</th><th>原因</th></tr>${missing.map(i=>`<tr><td>${esc(i.path)}</td><td>${esc(i.error)}</td></tr>`).join('')}</table></html>`);
console.log(JSON.stringify({...result,missing:undefined}));await pool.end();
