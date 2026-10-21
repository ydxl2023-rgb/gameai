import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {hostname} from 'node:os';
import {tempRoot,projectRoot,platformRoot} from '../paths.js';
import {designExecutionIds} from '../database/recovery-protocol.js';
import {submitRequirement,ReviewError} from '../database/requirements.js';
import {preserveUiTemplateContext} from '../database/ui-template-context.js';
import {runPmCli} from './pm-dispatch.js';

export async function resumeDesignDrafts(pool, {execute=runPmCli, projectId=null, repairedJob=null}={})
{
    const c = await pool.connect();
    let job;
    try
    {
        await c.query('BEGIN');
        const candidates = (await c.query(`SELECT j.*,p.project_key,j.started_at<now()-interval '20 minutes' expired
            FROM gameai.design_draft_jobs j JOIN gameai.projects p ON p.id=j.project_id
            JOIN gameai.agents a ON a.id=j.design_agent_id JOIN gameai.workers w ON w.id=a.worker_id
            WHERE (j.state IN ('queued','running','failed','unknown') OR (j.id=$3::uuid AND j.state='attention')) AND j.next_attempt_at<=now()
            AND ($1::uuid IS NULL OR j.project_id=$1) AND lower(w.worker_key)=lower($2)
            ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 20`,[projectId,hostname(),repairedJob?.reason ? repairedJob.id : null])).rows;
        for (const row of candidates)
        {
            if (!(await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[row.project_id])).rows[0].locked) continue;
            const binding = (await c.query(`SELECT a.enabled AND w.enabled enabled FROM gameai.fixed_agents f JOIN gameai.agents a ON a.id=f.agent_id
                JOIN gameai.workers w ON w.id=a.worker_id WHERE f.project_id=$1 AND f.role_code='Design'
                AND f.agent_id=$2`,[row.project_id,row.design_agent_id])).rows[0];
            if (!binding)
            {
                await c.query("UPDATE gameai.design_draft_jobs SET state='attention',error='原 Design 绑定已变更，需要核实' WHERE id=$1",[row.id]);
                continue;
            }
            if (!binding.enabled)
            {
                await c.query("UPDATE gameai.design_draft_jobs SET error='原 Design 或工作站已停用，等待恢复后继续原请求',next_attempt_at=now()+interval '30 seconds' WHERE id=$1",[row.id]);
                continue;
            }
            if (row.state === 'running' && !row.expired) continue;
            const proof = row.execution_id ? (await c.query(`SELECT r.state,s.agent_id FROM gameai.agent_runs r
                JOIN gameai.agent_conversations s ON s.id=r.conversation_id WHERE r.execution_id=ANY($1::text[])`,[designExecutionIds(row.execution_id)])).rows : [];
            if (proof.some(r=>!['completed','failed'].includes(r.state) || r.agent_id!==row.design_agent_id))
            {
                await c.query("UPDATE gameai.design_draft_jobs SET state='unknown',error='原 Design 进程尚未确认停止，等待停止凭据',next_attempt_at=now()+interval '30 seconds' WHERE id=$1",[row.id]);
                continue;
            }
            // Replay persisted output before spending another model attempt.
            let saved;
            if (row.execution_id && !row.submission)
            {
                try
                {
                    saved = JSON.parse(await readFile(join(tempRoot,'design',row.execution_id,'response.json'),'utf8'));
                }
                catch (error)
                {
                    if (error.code !== 'ENOENT')
                    {
                        await c.query("UPDATE gameai.design_draft_jobs SET state='attention',error='Design 检查点损坏，需要恢复原结果' WHERE id=$1",[row.id]);
                        continue;
                    }
                }
            }
            if (!saved && !row.submission)
            {
                const verifiedRepair=repairedJob?.id===row.id && Boolean(repairedJob.reason) && row.attempts===3 && ['attention','failed'].includes(row.state);
                if (row.attempts >= 3 && !verifiedRepair)
                {
                    await c.query("UPDATE gameai.design_draft_jobs SET state='attention',error='三次执行预算已用尽，保留原输入与检查点等待针对性修复' WHERE id=$1",[row.id]);
                    continue;
                }
                const busy = (await c.query(`SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id
                    WHERE s.agent_id=$1 AND r.state IN ('running','unknown') UNION ALL
                    SELECT 1 FROM gameai.design_draft_jobs WHERE design_agent_id=$1 AND id<>$2 AND state IN ('running','unknown')`,[row.design_agent_id,row.id])).rowCount;
                if (busy || (await c.query("SELECT 1 FROM gameai.requirement_revisions WHERE design_agent_id=$1 AND state IN ('running','unknown')",[row.design_agent_id])).rowCount) continue;
                if (verifiedRepair)
                {
                    // Explicit host repair grants one attempt without erasing prior failures.
                    await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'host','已验证修复后恢复原 Design 请求',$2)",[row.project_id,{job_id:row.id,reason:repairedJob.reason,prior_attempts:row.attempts,additional_attempts:1}]);
                }
            }
            const operation = saved || row.submission ? row.execution_id : randomUUID().replaceAll('-','');
            job = (await c.query(`UPDATE gameai.design_draft_jobs SET state='running',started_at=now(),execution_id=$2,
                attempts=attempts+$3,history=history||$4::jsonb WHERE id=$1 RETURNING *`,
            [row.id,operation,saved || row.submission ? 0 : 1,JSON.stringify(row.execution_id && operation!==row.execution_id ? [{execution_id:row.execution_id,error:row.error}] : [])])).rows[0];
            job.project_key = row.project_key;
            job.saved = saved;
            break;
        }
        await c.query('COMMIT');
    }
    catch (error)
    {
        await c.query('ROLLBACK');
        throw error;
    }
    finally
    {
        c.release();
    }
    if (job) await runDesignDraft(pool,job,execute);
}

async function runDesignDraft(pool, job, execute)
{
    try
    {
        let submission = job.submission;
        if (!submission)
        {
            let response = job.saved;
            if (!response)
            {
                const directory = join(tempRoot,'design-jobs',job.id,job.execution_id);
                await mkdir(directory,{recursive:true});
                const prompt = join(directory,'prompt.txt');
                await writeFile(prompt,job.input.prompt+'\n已确认初稿依据：'+job.input.draft_approval+'\n上次技术故障：'+job.error);
                const args = ['--project',projectRoot,'--project-id',job.project_id,'--prompt-file',prompt,'--key',job.input.requirement_key,
                    '--version',job.input.version,'--execution-id',job.execution_id,'--skills',join(platformRoot,'skills'),'--timeout','900'];
                for (const [field,option,name] of [['source_html','--source-document','source.html'],['windows_json','--window-spec','windows.json']])
                {
                    if (job.input[field])
                    {
                        const path = join(directory,name);
                        await writeFile(path,job.input[field]);
                        args.push(option,path);
                    }
                }
                // Reuse the most recent complete model draft after a transport failure.
                // A fresh operation still compiles it and obtains an independent review.
                for (const prior of [...job.history].reverse())
                {
                    let found=false;
                    for (let revision=2;revision>=0;revision--)
                    {
                        const draft=join(tempRoot,'design',prior.execution_id,`${revision}-draft.json`);
                        try
                        {
                            const value=JSON.parse(await readFile(draft,'utf8'));
                            if (typeof value.html==='string' && value.html.includes('</html>') && Array.isArray(value.questions) && !value.questions.length)
                            {
                                args.push('--draft-file',draft);
                                found=true;
                                break;
                            }
                        }
                        catch (error)
                        {
                            if (error.code!=='ENOENT' && !(error instanceof SyntaxError)) throw error;
                        }
                    }
                    if (found) break;
                }
                const run = await execute(args,['design','draft']);
                await writeFile(join(directory,'diagnostics.txt'),run.diagnostics ?? '');
                if (!run.output?.trim())
                {
                    const oversized=run.diagnostics?.match(/CODEX_INPUT_TOO_LARGE:[^\r\n]*/)?.[0];
                    if (oversized) throw new ReviewError(oversized+'；保留已生成文档，修复传输后继续自检，禁止相同输入盲重试。');
                    throw new Error(`Design 未返回结果（exit=${run.code}, timeout=${Boolean(run.timedOut)}）；保留检查点等待恢复。`);
                }
                response = JSON.parse(run.output);
                if (!response.questions?.length && (run.code!==0 || run.timedOut || run.overflow)) throw new Error('Design 执行中断，等待核实并恢复原任务');
            }
            if (!response || typeof response !== 'object') throw new ReviewError('Design 检查点格式无效');
            if (response.questions !== undefined && !Array.isArray(response.questions)) throw new ReviewError('Design 问题清单格式无效');
            if (response.questions?.length)
            {
                await pool.query("UPDATE gameai.design_draft_jobs SET state='needs_input',error=$2 WHERE id=$1 AND state='running'",[job.id,response.questions.join('\n')]);
                return;
            }
            if (response.status !== 'draft_saved' || typeof response.submission !== 'string') throw new ReviewError('Design 未返回经过自检的文档');
            const file = resolve(response.submission);
            const inside = relative(join(tempRoot,'design',job.execution_id),file);
            if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new ReviewError('Design 结果不属于本次执行目录');
            try
            {
                submission = JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
            }
            catch
            {
                throw new ReviewError('Design 已保存的交付不可读取，需要恢复原文件');
            }
            if (submission?.requirement_key!==job.input.requirement_key || submission?.version!==job.input.version) throw new ReviewError('Design 改动了需求编号或版本');
            if (!designExecutionIds(job.execution_id).includes(submission.execution_id)) throw new ReviewError('Design 交付不属于本次操作');
            if (job.input.source_html && preserveUiTemplateContext(job.input.source_html,submission.html)!==submission.html) throw new ReviewError('Design 丢失固定模板来源');
            const updated = await pool.query("UPDATE gameai.design_draft_jobs SET submission=$2 WHERE id=$1 AND state='running' AND execution_id=$3",[job.id,submission,job.execution_id]);
            if (!updated.rowCount) return;
        }
        // Persisting submission closes cancellation. Publication remains idempotent after acknowledgement loss.
        const current = (await pool.query("SELECT state FROM gameai.design_draft_jobs WHERE id=$1",[job.id])).rows[0];
        if (current?.state !== 'running') return;
        const receipt = await submitRequirement(pool,job.project_key,submission);
        await pool.query("UPDATE gameai.design_draft_jobs SET state='completed',receipt=$2,error='' WHERE id=$1 AND state='running'",[job.id,receipt]);
    }
    catch (error)
    {
        await pool.query("UPDATE gameai.design_draft_jobs SET state=$4,error=$2,next_attempt_at=now()+interval '30 seconds' WHERE id=$1 AND state='running' AND execution_id=$3",[job.id,error.message,job.execution_id,error instanceof ReviewError ? 'attention' : 'failed']);
    }
}
