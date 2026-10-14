import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {loadEnvFile} from 'node:process';
import {loadBatch,validateDocument,importBatch} from '../src/ui-library/library.js';

const root=process.argv[2];
loadEnvFile(new URL('../.env.workflow',import.meta.url));
const {createPool}=await import('../src/database/connection.js');
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
const rejected=[];const entries=new Map();const docs=new Map();
for(const entry of manifest.entries){try{const doc=validateDocument(JSON.parse(await readFile(path.join(root,entry.file),'utf8')));const visual=JSON.parse(await readFile(path.join(root,entry.visualFile),'utf8'));const ids=new Set(doc.prefab.nodes.map(n=>n.id));if([...visual.bindings,...visual.components].some(b=>!ids.has(b.nodeId)))throw new Error('Unknown visual node');entries.set(entry.guid,entry);docs.set(entry.guid,doc);}catch(error){rejected.push({assetPath:entry.assetPath,error:error.message});}}
let changed=true;while(changed){changed=false;for(const [id,entry]of entries){if(Object.values(docs.get(id).resources).some(r=>!entries.has(r.id))){entries.delete(id);rejected.push({assetPath:entry.assetPath,error:'Dependency was rejected'});changed=true;}}}
const subset={...manifest,failed:0,entries:[...entries.values()],selection:{sourceManifest:'manifest.json',sourceFailures:manifest.failed,rejected}};
await writeFile(path.join(root,'accepted-manifest.json'),JSON.stringify(subset));
const pool=createPool();let result;
try{result=entries.size ? await importBatch(pool,await loadBatch(root,'accepted-manifest.json')):{success:true,inserted:0,skipped:0,versions:[]};result.sourceFailures=manifest.failed;result.rejected=rejected;await writeFile(path.join(root,'import-result.json'),JSON.stringify(result));console.log(JSON.stringify({success:result.success,inserted:result.inserted,skipped:result.skipped,rejected:rejected.length,sourceFailures:manifest.failed}));}finally{await pool.end();}
