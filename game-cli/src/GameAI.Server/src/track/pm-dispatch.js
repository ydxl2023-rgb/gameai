import {buildProductionSkeleton,validateDesignDocument} from '../database/design-contract.js';
import {parsePmOutcome,recordPmBlock} from '../database/requirement-revisions.js';
import {resumeRequirementRevisions} from './requirement-revision-flow.js';
import {projectRoot,platformRoot,tempRoot} from '../paths.js';
import { prepareApprovedDocument } from '../database/approved-document.js';
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publishPmPlan, failPmJob, validatePmPlan } from '../database/pm-plans.js';
import { ReviewError } from '../database/requirements.js';
import { validateUiDeliveryPlan } from '../database/ui-delivery-plan.js';
import {prepareUiDocumentPrompt} from '../database/ui-document-prompt.js';

const repository = projectRoot;

const cli = join(platformRoot,'src/GameAI.Cli/GameCLI/bin/Release/net8.0/GameCLI.dll');

export async function checkPmRuntime()
{
    try
    {
        await access(cli);
        await access(join(repository,'.gamecli/client.json'));
    }
    catch
    {
        throw new ReviewError('请先构建 Release GameCLI 并配置本机固定 Agent 连接。');
    }
}

export function runPmCli(args, command = ['pm','plan'], options = {})
{
    return new Promise((resolve,reject) =>
    {
        // Credentials needed by the CLI live in its local connection file, never in model input.
        const env = { ...process.env };
        for (const key of Object.keys(env))
        {
            if (key.startsWith('PG') || key === 'SUBMISSION_TOKEN')
            {
                delete env[key];
            }
        }
        const child = spawn('dotnet',[cli,...command,...args],{cwd:repository,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        let output = '';
        let diagnostics = '';
        let overflow = false;
        let timedOut = false;
        const timer = setTimeout(() =>
        {
            timedOut = true;
            child.kill();
        }, options.timeoutMs ?? (command[1] === 'execute' ? 32 : 17)*60*1000);
        child.stdout.on('data',chunk =>
        {
            if (output.length+chunk.length > 8*1024*1024)
            {
                overflow = true;
                child.kill();
            }
            else
            {
                output += chunk;
            }
        });
        child.stderr.on('data',chunk =>
        {
            diagnostics = (diagnostics+chunk).slice(-16000);
        });
        child.on('error',error =>
        {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close',code =>
        {
            clearTimeout(timer);
            resolve({code,output,diagnostics,overflow,timedOut});
        });
    });
}

export async function dispatchPmJob(pool, projectKey, started, execute = runPmCli, {recoverPublication=false}={})
{
    const { job,document } = started;
    const directory = join(tempRoot,'pm-jobs',job.execution_id);
    let phase='input';
    try
    {
        await mkdir(directory,{recursive:true});
        let skeleton;
        try { skeleton = buildProductionSkeleton(document.html,document.version); }
        catch (error) { throw new ReviewError('PM 输入契约校验失败：'+error.message); }
        await pool.query('UPDATE gameai.pm_jobs SET recover_publication=true WHERE id=$1 AND execution_id=$2',[job.id,job.execution_id]);
        await writeFile(join(directory,'skeleton.json'),JSON.stringify(skeleton,null,2),'utf8');
        const input = join(directory,'input.txt');
        const approvedDocument = await prepareApprovedDocument(job.requirement_version_id,job.document_hash,document.html);
        await writeFile(input,`权威文档信息：${JSON.stringify(approvedDocument)}\n需求：${document.requirement_key} / ${document.title}\n版本：${document.version}\n修订：${job.revision}\n文档 SHA256：${job.document_hash}\n由 RodFergusson 按 UI 与 Art 模块拆分，每个独立窗口为白模、资源包、最终装配三项，当前不拆程序与 QA 子任务，来源引用需包含原文章节或交付项编号。不得扩展已批准范围。\n以下是已批准的原始 HTML 数据：\n${prepareUiDocumentPrompt(document.html,approvedDocument)}`,'utf8');
        await writeFile(input,`\n服务端固定骨架（最高优先级结构约束）：\n${JSON.stringify(skeleton)}\n逐项输出相同 id、role、source_refs、depends_on，仅补充 title、description、acceptance 以及 summary。phase 由固定 id 表示，不增加输出字段。原文与清单矛盾时停止并报告，不修补结构、不生成替代计划。完整窗口原文位于上方 HTML 的对应 section。\n`,{encoding:'utf8',flag:'a'});
        await writeFile(input,`\n上次执行错误（如有）：${JSON.stringify(job.recovery_history ?? [])}\n恢复同一需求拆分：先诊断错误，复用有效工作，不生成重复任务或降低骨架检查。`,{encoding:'utf8',flag:'a'});
        phase='execution';
        const run=await execute(['--project',repository,'--key',document.requirement_key,'--execution-id',job.execution_id,'--prompt-file',input,'--skills',join(platformRoot,'skills')]);
        await writeFile(join(directory,'diagnostics.txt'),run.diagnostics,'utf8');
        if(run.timedOut || run.overflow || run.code!==0)
        {
            const size = /CODEX_INPUT_TOO_LARGE: actual_chars=(\d+), max_chars=(\d+)/.exec(run.diagnostics ?? '');
            if (size) throw new ReviewError(`PM 输入超过传输上限：${size[1]} 字符，上限 ${size[2]}；需要调整无损传输，未创建任务。`);
            throw new ReviewError('RodFergusson 拆分失败或超时，未创建任务。');
        }
        await writeFile(join(directory,'agent-output.json'),run.output,'utf8');
        phase='validation';
        const result=JSON.parse(run.output);
        if(result.execution_id!==job.execution_id || !Array.isArray(result.plan?.tasks) || result.plan.tasks.some(t=>!['Prefab','Art'].includes(t.role))) throw new ReviewError('当前只允许 UI 白模、美术资源和预制装配任务。');
        const outcome = parsePmOutcome(result.plan);
        if (outcome.outcome === 'execution_error') throw new ReviewError(outcome.summary+'\n'+outcome.issues.map(i=>i.evidence).join('\n'));
        if (outcome.outcome !== 'ready')
        {
            await recordPmBlock(pool,job,outcome);
            void resumeRequirementRevisions(pool).catch(error=>console.error('修订调度失败',error.message));
            return;
        }
        result.plan = {summary:outcome.summary,tasks:outcome.tasks};
        result.scope='ui-only';
        result.plan = validateUiDeliveryPlan(validatePmPlan(result.plan),skeleton);
        await writeFile(join(directory,'result.json'),JSON.stringify(result),'utf8');
        await pool.query('UPDATE gameai.pm_jobs SET publication_result=$2 WHERE id=$1',[job.id,result]);
        phase='publication';
        await publishPmPlan(pool,projectKey,job,result,{recoverPublication});
        console.info('PM 拆分已入库', { execution_id:job.execution_id });
    }
    catch (error)
    {
        const message = error instanceof ReviewError ? error.message : 'PM 处理或发布失败，请检查服务日志；未发布不完整任务。';
        console.error('PM 拆分失败', { execution_id:job.execution_id, error:error instanceof Error ? error.message : String(error) });
        await failPmJob(pool,job,message);
        await pool.query(`UPDATE gameai.pm_jobs SET recovery_code=$3,recovery_at=now()+interval '30 seconds'
            WHERE id=$1 AND execution_id=$2 AND state IN ('failed','unknown')`,[job.id,job.execution_id,phase==='publication' ? 'publication' : 'technical_failure']);
    }
}
