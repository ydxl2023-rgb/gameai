import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {projectRoot,tempRoot} from '../paths.js';
import {readUiTemplateContext} from '../database/ui-template-context.js';
import {runPmCli} from './pm-dispatch.js';
import {readTaskInput} from '../database/ui-task-plans.js';
import {loadTaskContext} from '../database/qa-context.js';
import {verifyTaskFiles} from '../database/task-files.js';

const unityProject=join(projectRoot,'app/client');
const unityCli=join(unityProject,'Library/UnityCLI/UnityCLI.exe');
export async function repairToolFingerprint()
{
    const hash=createHash('sha256');
    hash.update(await readFile(join(projectRoot,'game-cli/src/GameAI.Cli/GameCLI/bin/Release/net8.0/GameCLI.dll')));
    hash.update(await readFile(join(unityProject,'LocalPackages/com.oathx.unitycli/Editor/Services/UnityCliChangeGuard.cs')));
    return hash.digest('hex');
}

export function runUnityProbe(args,timeout=30000)
{
    return new Promise((resolve,reject)=>
    {
        const child=spawn(unityCli,['--project',unityProject,'--format','json',...args],{cwd:projectRoot,windowsHide:true,env:{...process.env,UNITYCLI_REQUEST_TIMEOUT_SECONDS:'25'},stdio:['ignore','pipe','pipe']});
        let output='';
        let diagnostics='';
        let expired=false;
        const timer=setTimeout(()=>{expired=true;child.kill();},timeout);
        child.stdout.on('data',chunk=>{if(output.length<2_000_000) output+=chunk;});
        child.stderr.on('data',chunk=>{if(diagnostics.length<10000) diagnostics+=chunk;});
        child.on('error',error=>{clearTimeout(timer);reject(error);});
        child.on('close',code=>{clearTimeout(timer);resolve({code:expired ? -1 : code,output,diagnostics});});
    });
}

export async function probeUnity()
{
    try
    {
        const result=await runUnityProbe(['ping']);
        const value=JSON.parse(result.output);
        // Ping may contain a local access token. Never store or expose its response.
        return result.code===0 && value.ok===true;
    }
    catch { return false; }
}

export async function preflightUiDocument(html,directory,execute=runPmCli,unity=runUnityProbe,options={})
{
    const payload=readUiTemplateContext(html)?.payload;
    const assembly=payload?.targetAssembly;
    if (!assembly) return {applicable:false};
    directory=join(directory,randomUUID());
    const hash=text=>createHash('sha256').update(text).digest('hex');
    if (hash(assembly.baselineJson)!==assembly.sourceSha256 || hash(assembly.snapshotJson)!==assembly.snapshotSha256 || hash(assembly.approvalJson)!==assembly.approvalSha256)
    {
        throw Object.assign(new Error('PLATFORM_GUARD_INVALID：批准附件中的执行封装哈希不匹配'),{code:'PLATFORM_GUARD_INVALID'});
    }
    await mkdir(directory,{recursive:true});
    const baseline=join(directory,'baseline.json');
    const candidate=join(directory,'candidate.json');
    const approval=join(directory,'approval.json');
    const output=join(directory,'validated-assembly.json');
    await writeFile(baseline,assembly.baselineJson,'utf8');
    await writeFile(candidate,assembly.snapshotJson,'utf8');
    await writeFile(approval,assembly.approvalJson,'utf8');
    const argumentsList=['--baseline',baseline,'--candidate',candidate,'--approval',approval,'--output',output];
    if (options.manifestPath) argumentsList.push('--manifest',options.manifestPath);
    const guard=await execute(argumentsList,['ui-library','guard'],{timeoutMs:30000});
    if (guard.code!==0) throw Object.assign(new Error('PLATFORM_GUARD_INVALID：冻结附件未通过宿主差异校验；需要修复工具或输入，禁止原样重跑。'),{code:'PLATFORM_GUARD_INVALID'});
    const checked=JSON.parse(await readFile(output,'utf8'));
    const restore=['prefab','restore','--json',output,'--prefab',checked.outputPrefab,'--replace','--dry-run'];
    if (!options.assembly) restore.push('--whitebox');
    const runtime=await unity(restore);
    let result;
    try { result=JSON.parse(runtime.output); } catch { result={}; }
    const safe=JSON.parse(JSON.stringify(result,(key,value)=>/token|password|secret/i.test(key) ? '[redacted]' : value));
    await writeFile(join(directory,'unity-dry-run.json'),JSON.stringify(safe),'utf8');
    if (runtime.code!==0 || !result.ok)
    {
        const available=await probeUnity();
        const code=available ? 'PLATFORM_GUARD_INVALID' : 'UNITY_UNAVAILABLE';
        throw Object.assign(new Error(code+'：Unity执行侧预检未通过，未修改资产。'+(result.message ?? '')), {code});
    }
    const receipt={applicable:true,handler:'exact-json-guard-v3',sourceSha256:checked.sourceSha256,snapshotSha256:checked.snapshotSha256,approvalSha256:checked.approvalSha256,resourceManifestSha256:checked.resourceManifestSha256 ?? null,documentSha256:createHash('sha256').update(html).digest('hex'),runtimeValidated:true,assembly:!!options.assembly,assemblyPath:output,evidenceDirectory:directory};
    await writeFile(join(directory,'receipt.json'),JSON.stringify(receipt),'utf8');
    return receipt;
}

export async function repairGuardPreflight(pool,row)
{
    const doc=(await pool.query(`SELECT d.bytes,a.sha256 FROM gameai.tasks t JOIN gameai.plan_versions p ON p.id=t.plan_version_id
        JOIN gameai.artifact_links l ON l.requirement_version_id=p.requirement_version_id
        JOIN gameai.artifacts a ON a.id=l.artifact_id JOIN gameai.document_contents d ON d.artifact_id=a.id
        WHERE t.id=$1 AND a.media_type='text/html'`,[row.task_id])).rows[0];
    if (!doc || createHash('sha256').update(doc.bytes).digest('hex')!==doc.sha256) throw new Error('批准文档缺失或哈希不匹配');
    const input=await readTaskInput(pool,row.task_id);
    const task=(await pool.query('SELECT * FROM gameai.tasks WHERE id=$1',[row.task_id])).rows[0];
    const context=await loadTaskContext(pool,task);
    const options=await uiPreflightOptions(input?.content,context.dependencies);
    const receipt=await preflightUiDocument(doc.bytes.toString('utf8'),join(tempRoot,'task-repairs',row.execution_id),runPmCli,runUnityProbe,options);
    return {...receipt,handlerFingerprint:await repairToolFingerprint()};
}

export async function uiPreflightOptions(content,dependencies)
{
    if (content?.type!=='prefab-assembly') return {};
    for (const dependency of dependencies ?? [])
    {
        const artifact=(dependency.artifacts ?? []).find(item=>item.path?.endsWith('/resource-snapshot.json'));
        if (!artifact) continue;
        if (!dependency.accepted || !await verifyTaskFiles([artifact])) throw new Error('正式装配资源清单未通过上游哈希核验');
        const path=join(projectRoot,artifact.path);
        const manifest=JSON.parse(await readFile(path,'utf8'));
        const slots=content.window.resourceSlots.filter(slot=>slot.kind==='sprite');
        const textures=manifest.visualTextures ?? [];
        // This legacy-template adapter supports frozen reuse resources. It cannot
        // invent missing generated assets or reinterpret the approved resource slots.
        if (slots.length!==textures.length || slots.some(slot=>!textures.some(texture=>texture.deliverySha256===slot.sourceReference?.sha256 && texture.deliveryWidth===slot.deliverySize?.width && texture.deliveryHeight===slot.deliverySize?.height)))
        {
            throw new Error('正式装配资源清单与冻结槽位数量、来源哈希或交付尺寸不一致');
        }
        return {assembly:true,manifestPath:path};
    }
    return {assembly:true};
}
