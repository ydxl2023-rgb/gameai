import {digest,canonical} from '../database/ui-production-contract.js';
import {projectRoot,platformRoot,tempRoot} from '../paths.js';
import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runPmCli } from './pm-dispatch.js';
import { finishTaskDispatch } from '../database/task-dispatch.js';
import {validateTaskResult} from '../database/task-results.js';
import { inspectTaskFiles } from '../database/task-files.js';
import { verifyApprovedDocument } from '../database/approved-document.js';

const repository = projectRoot;
export async function runTaskDispatch(pool,job,execute=runPmCli)
{
    let result=null;
    let error=null;
    try
    {
        const directory=join(tempRoot,'task-jobs',job.executionId);
        await mkdir(directory,{recursive:true});
        const input=join(directory,'input.txt');
        await verifyApprovedDocument(JSON.parse(job.prompt).approved_document);
        const production = JSON.parse(job.prompt).production_contract;
        if (production)
        {
            if (digest(production.content) !== production.sha256) throw new Error('生产契约执行输入哈希不匹配');
            // Use a server-owned destination, never a model-provided path.
            await writeFile(join(directory,'production-input.json'),canonical(production.content),'utf8');
        }
        await writeFile(input,job.prompt,'utf8');
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
        const content=validateTaskResult(JSON.parse(result.Text),job.role);
        await writeFile(join(directory,'result.json'),run.output,'utf8');
        if (result.InputSha256!==createHash('sha256').update(job.prompt).digest('hex')) throw new Error('执行输入哈希不匹配');
        result.artifacts=await inspectTaskFiles(content.files);
    }
    catch(cause) { error=cause instanceof Error ? cause.message : '执行结果处理失败'; }
    await finishTaskDispatch(pool,job,result,error);
}
