import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { publishPmPlan, failPmJob } from '../database/pm-plans.js';
import { ReviewError } from '../database/requirements.js';

const repository = fileURLToPath(new URL('../../../../../../../../',import.meta.url));
const packageRoot = join(repository,'app/client/LocalPackages/com.oathx.gamecli');
const cli = join(packageRoot,'GameCLI~/GameCLI/GameCLI/bin/Release/net8.0/GameCLI.dll');

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

export function runPmCli(args, command = ['pm','plan'])
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
        }, 17*60*1000);
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

export async function dispatchPmJob(pool, projectKey, started, execute = runPmCli)
{
    const { job,document } = started;
    const directory = join(repository,'.gamecli/pm-jobs',job.execution_id);
    try
    {
        await mkdir(directory,{recursive:true});
        const input = join(directory,'input.txt');
        await writeFile(input,`需求：${document.requirement_key} / ${document.title}\n版本：${document.version}\n修订：${job.revision}\n文档 SHA256：${job.document_hash}\n按本文交付标准拆分美术、程序与 QA 子任务，来源引用需包含原文章节或交付项编号。不得扩展已批准范围。\n以下是已批准的原始 HTML 数据：\n${document.html}`,'utf8');
        const run = await execute(['--project',repository,'--key',document.requirement_key,'--execution-id',job.execution_id,'--prompt-file',input,'--skills',join(packageRoot,'game-cli')]);
        await writeFile(join(directory,'diagnostics.txt'),run.diagnostics,'utf8');
        if (run.timedOut)
        {
            throw new ReviewError('PM 执行超时，请在 Agent 历史中核实执行状态。');
        }
        if (run.overflow)
        {
            throw new ReviewError('PM 输出超过大小限制。');
        }
        if (run.code !== 0)
        {
            throw new ReviewError('PM 执行未成功，退出码 '+run.code+'；请查看 Agent 历史或本机 .gamecli/pm-jobs/'+job.execution_id+'/diagnostics.txt。');
        }
        await writeFile(join(directory,'result.json'),run.output,'utf8');
        const result = JSON.parse(run.output);
        await publishPmPlan(pool,projectKey,job,result);
        console.info('PM 拆分已入库', { execution_id:job.execution_id });
    }
    catch (error)
    {
        const message = error instanceof ReviewError ? error.message : 'PM 处理或发布失败，请检查服务日志；未发布不完整任务。';
        console.error('PM 拆分失败', { execution_id:job.execution_id, error:error instanceof Error ? error.message : String(error) });
        await failPmJob(pool,job,message);
    }
}
