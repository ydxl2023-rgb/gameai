import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runPmCli } from './pm-dispatch.js';
import { finishTaskDispatch } from '../database/task-dispatch.js';
import {validateTaskResult} from '../database/task-results.js';
import { inspectTaskFiles } from '../database/task-files.js';

const repository=fileURLToPath(new URL('../../../../../../../../',import.meta.url));
export async function runTaskDispatch(pool,job,execute=runPmCli)
{
    let result=null;
    let error=null;
    try
    {
        const directory=join(repository,'.gamecli/task-jobs',job.executionId);
        await mkdir(directory,{recursive:true});
        const input=join(directory,'input.txt');
        await writeFile(input,job.prompt,'utf8');
        const run=await execute(['--project',repository,'--key',job.key,'--execution-id',job.executionId,'--prompt-file',input],[job.role.toLowerCase(),'execute']);
        await writeFile(join(directory,'diagnostics.txt'),run.diagnostics,'utf8');
        if (run.code!==0 || run.timedOut || run.overflow) throw new Error('任务进程未正常结束，请在 Agent 历史与本机任务日志中核实。');
        result=JSON.parse(run.output);
        const content=validateTaskResult(JSON.parse(result.Text),job.role);
        await writeFile(join(directory,'result.json'),run.output,'utf8');
        if (result.InputSha256!==createHash('sha256').update(job.prompt).digest('hex')) throw new Error('执行输入哈希不匹配');
        result.artifacts=await inspectTaskFiles(content.files);
    }
    catch(cause) { error=cause instanceof Error ? cause.message : '执行结果处理失败'; }
    await finishTaskDispatch(pool,job,result,error);
}
