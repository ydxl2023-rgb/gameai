import {digest,canonical} from '../database/ui-production-contract.js';
import {projectRoot,platformRoot,tempRoot} from '../paths.js';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import {saveTaskResponse,publishTaskResponse} from './task-publication.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runPmCli } from './pm-dispatch.js';
import { finishTaskDispatch } from '../database/task-dispatch.js';
import {validateTaskResult,parseTaskResult} from '../database/task-results.js';
import { inspectTaskFiles } from '../database/task-files.js';
import {deliveryFailure} from '../database/delivery-errors.js';
import { verifyApprovedDocument } from '../database/approved-document.js';
import {preflightUiDocument,uiPreflightOptions} from './task-preflight.js';

const repository = projectRoot;
export async function runTaskDispatch(pool,job,execute=runPmCli)
{
    let result=null;
    let error=null;
    let failure=null;
    let executionStarted=false;
    try
    {
        const directory=join(tempRoot,'task-jobs',job.executionId);
        await mkdir(directory,{recursive:true});
        const input=join(directory,'input.txt');
        await verifyApprovedDocument(JSON.parse(job.prompt).approved_document);
        if (['Prefab','Art'].includes(job.role))
        {
            const approved=JSON.parse(job.prompt).approved_document;
            const {readFile}=await import('node:fs/promises');
            const html=await readFile(join(repository,approved.path),'utf8');
            const prompt=JSON.parse(job.prompt);
            const options=await uiPreflightOptions(prompt.production_contract?.content,prompt.dependencies);
            const receipt=await preflightUiDocument(html,join(directory,'preflight'),undefined,undefined,options);
            await writeFile(join(directory,'execution-preflight.json'),JSON.stringify(receipt),'utf8');
        }
        const production = JSON.parse(job.prompt).production_contract;
        if (production)
        {
            if (digest(production.content) !== production.sha256) throw new Error('生产契约执行输入哈希不匹配');
            // Use a server-owned destination, never a model-provided path.
            await writeFile(join(directory,'production-input.json'),canonical(production.content),'utf8');
        }
        await writeFile(input,job.prompt,'utf8');
        executionStarted=true;
        const run=await execute(['--project',repository,'--key',job.key,'--execution-id',job.executionId,'--prompt-file',input,'--timeout','1800'],[job.role.toLowerCase(),'execute']);
        await writeFile(join(directory,'diagnostics.txt'),run.diagnostics,'utf8');
        if (run.code!==0 || run.timedOut || run.overflow)
        {
            if (run.timedOut || /AGENT_EXECUTION_TIMEOUT/.test(run.diagnostics ?? '')) throw new Error('任务执行超时，需核实停止凭据；确认停止后复用已有产物及检查证据继续。');
            const size = /CODEX_INPUT_TOO_LARGE: actual_chars=(\d+), max_chars=(\d+)/.exec(run.diagnostics ?? '');
            if (size) throw new Error(`任务输入超过传输上限：${size[1]} 字符，上限 ${size[2]}，需修复传输后再执行。`);
            throw new Error('任务进程未正常结束，请在 Agent 历史与本机任务日志中核实。');
        }
        result=JSON.parse(run.output);
        await writeFile(join(directory,'result.json'),run.output,'utf8');
    }
    catch(cause) { error=cause instanceof Error ? cause.message : '执行结果处理失败'; failure=cause.code || !executionStarted ? {code:cause.code ?? 'HOST_PREFLIGHT_FAILED',items:[],pre_execution:!executionStarted} : null; }
    // Persist the response before any delivery validation or transaction publication.
    const response={result,error,failure};
    await saveTaskResponse(pool,job,response);
    await publishTaskResponse(pool,job,response,finishReceivedTask);
}

export async function finishReceivedTask(pool,job,response)
{
    let result=structuredClone(response.result);
    let error=response.error;
    let failure=response.failure ?? null;
    if (!result && error)
    {
        try
        {
            const checkpoint=JSON.parse(await readFile(join(tempRoot,'agent-checkpoints',job.executionId.replaceAll('-','')+'.json'),'utf8'));
            if (checkpoint.InputSha256===createHash('sha256').update(job.prompt).digest('hex'))
            {
                const content=parseTaskResult(JSON.parse(checkpoint.Text));
                result=checkpoint;
                try { if (content.files.length) result.artifacts=await inspectTaskFiles(content.files); }
                catch (cause) { result.checkpoint_error=cause.message; }
                // A final message is a checkpoint, not completed cloud proof. Keep
                // the failure and let the original Agent verify/reuse it on recovery.
            }
        }
        catch (cause)
        {
            if (cause.code!=='ENOENT') console.error('执行检查点未通过读取或格式校验',job.executionId);
        }
    }
    if (!error)
    {
        try
        {
            if (result.InputSha256!==createHash('sha256').update(job.prompt).digest('hex')) throw new Error('执行输入哈希不匹配');
            const content=parseTaskResult(JSON.parse(result.Text));
            let verdictError=null;
            try { validateTaskResult(content,job.role); } catch (cause) { verdictError=cause; }
            // Failed runs still own useful checkpoints. Hash files without treating
            // the failed verdict as a successful delivery or registering those assets.
            try { if (content.files.length) result.artifacts=await inspectTaskFiles(content.files); }
            catch (cause) { if (!verdictError) throw cause; result.checkpoint_error=cause.message; }
            if (verdictError) throw verdictError;
        }
        catch (cause) { error=cause.message; failure=deliveryFailure(cause); }
    }
    await finishTaskDispatch(pool,job,result,error,{recoverPublication:true,failure});
}
