import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {projectRoot,platformRoot,tempRoot} from '../paths.js';
import {runPmCli} from './pm-dispatch.js';
import {submitRequirement} from '../database/requirements.js';
import {buildUiDeliverySkeleton} from '../database/ui-delivery-plan.js';

async function finish(pool, job, state, message)
{
    await pool.query(`WITH changed AS (UPDATE gameai.requirement_revisions SET state=$2,error=$3,finished_at=now() WHERE id=$1 AND state='running' RETURNING *)
        INSERT INTO gameai.audit_events(project_id,actor,event,payload) SELECT project_id,'orchestrator','需求修订停止',jsonb_build_object('revision_id',id,'state',state,'error',error) FROM changed`,[job.id,state,message.slice(0,8000)]);
}

export async function runRequirementRevision(pool, job, execute=runPmCli)
{
    try
    {
        const source = (await pool.query(`SELECT v.*,q.requirement_key,q.title,p.project_key,d.bytes,a.sha256 FROM gameai.requirement_versions v
            JOIN gameai.requirements q ON q.id=v.requirement_id JOIN gameai.projects p ON p.id=v.project_id
            JOIN gameai.artifact_links l ON l.requirement_version_id=v.id JOIN gameai.artifacts a ON a.id=l.artifact_id
            JOIN gameai.document_contents d ON d.artifact_id=a.id WHERE v.id=$1 AND a.media_type='text/html'`,[job.source_version_id])).rows[0];
        if (!source || createHash('sha256').update(source.bytes).digest('hex')!==source.sha256) throw new Error('原始 HTML 哈希校验失败。');
        if ((await pool.query('SELECT 1 FROM gameai.requirement_versions WHERE requirement_id=$1 AND ordinal>$2',[source.requirement_id,source.ordinal])).rowCount)
        {
            await finish(pool,job,'superseded','已有较新版本，停止旧版本修订。');
            return;
        }
        let payload = job.submission;
        if (!payload)
        {
            const directory=join(tempRoot,'requirement-revisions',job.id);
            await mkdir(directory,{recursive:true});
            const prompt=join(directory,'prompt.txt');
            await writeFile(prompt,`这是编排器退回的确定性文档修订，沿用已批准的业务范围，无需重新调研。原需求 ${source.requirement_key}，标题必须原样为 ${source.title}。新版本必须为 ${job.target_version}。\n只修正以下明确问题，保留窗口、控件、资源、交互规则、HTML线框与完整内容。不得修改功能范围，不得自行审批、建单或派工。需要用户决策时返回 questions，不能猜测。自检正文计数、名称、内部编号与清单完全一致，summary逐项说明修复证据；新版本状态待人工审批。\nPM问题报告：${JSON.stringify(job.report)}\n已校验原文 SHA256：${source.sha256}\n原始完整HTML：\n${source.bytes.toString('utf8')}`,'utf8');
            const run=await execute(['--project',projectRoot,'--prompt-file',prompt,'--key',source.requirement_key,'--version',job.target_version,'--skills',join(platformRoot,'skills'),'--timeout','900'],['design','draft']);
            await writeFile(join(directory,'diagnostics.txt'),run.diagnostics??'','utf8');
            await writeFile(join(directory,'output.json'),run.output??'','utf8');
            let response;
            try { response=JSON.parse(run.output); } catch { /* Process failures are reported without inventing document issues. */ }
            if (response?.questions?.length)
            {
                await finish(pool,job,'needs_input',response.questions.join('\n'));
                return;
            }
            if (run.code!==0 || run.timedOut || run.overflow || response?.status!=='draft_saved') throw new Error('Design 执行故障或超时，请查看修订执行日志；未改变需求。');
            const file=resolve(response.submission);
            const rel=relative(resolve(tempRoot,'design'),file);
            if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Design 返回了非法交付路径。');
            payload=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
            if (payload.requirement_key!==source.requirement_key || payload.version!==job.target_version || payload.title!==source.title) throw new Error('Design 改动了需求编号、标题或目标版本。');
            const original=buildUiDeliverySkeleton(source.bytes.toString('utf8'),source.version);
            const revised=buildUiDeliverySkeleton(payload.html,payload.version);
            if (JSON.stringify(original.tasks)!==JSON.stringify(revised.tasks)) throw new Error('修订改变了窗口交付骨架，需要人工确认范围。');
            await pool.query("UPDATE gameai.requirement_revisions SET submission=$2 WHERE id=$1 AND state='running'",[job.id,payload]);
        }
        await submitRequirement(pool,source.project_key,payload,job.id);
    }
    catch (error)
    {
        await finish(pool,job,'failed',error.message);
    }
}

export async function resumeRequirementRevisions(pool, execute=runPmCli)
{
    // A persisted result can be resubmitted idempotently without ever rerunning the model.
    const ready=(await pool.query("SELECT * FROM gameai.requirement_revisions WHERE state='running' AND submission IS NOT NULL")).rows;
    for (const saved of ready)
    {
        await runRequirementRevision(pool,saved,execute);
    }
    await pool.query(`UPDATE gameai.requirement_revisions r SET state='needs_input',error='原 Design 绑定已变更或被禁用，请人工核实，不能静默转交。'
        WHERE r.state='queued' AND NOT EXISTS(SELECT 1 FROM gameai.fixed_agents f JOIN gameai.agents a ON a.id=f.agent_id
            WHERE f.project_id=r.project_id AND f.role_code='Design' AND f.agent_id=r.design_agent_id AND a.enabled)`);
    // Never rerun an uncertain process after a restart; it may still own the fixed Agent lease.
    await pool.query("UPDATE gameai.requirement_revisions SET state='unknown',error='修订进程超过运行时限，需核实原 Design 执行；未自动重跑。' WHERE state='running' AND started_at<now()-interval '20 minutes' AND submission IS NULL");
    const c=await pool.connect();
    let job;
    try
    {
        await c.query('BEGIN');
        const candidate=(await c.query(`SELECT r.* FROM gameai.requirement_revisions r
            JOIN gameai.fixed_agents f ON f.project_id=r.project_id AND f.role_code='Design' AND f.agent_id=r.design_agent_id
            JOIN gameai.agents a ON a.id=f.agent_id JOIN gameai.workers w ON w.id=a.worker_id
            WHERE r.state='queued' AND a.enabled AND w.enabled AND lower(w.worker_key)=lower($1)
            AND NOT EXISTS(SELECT 1 FROM gameai.requirement_revisions active WHERE active.project_id=r.project_id AND active.state IN ('running','unknown'))
            AND NOT EXISTS(SELECT 1 FROM gameai.agent_runs ar JOIN gameai.agent_conversations ac ON ac.id=ar.conversation_id WHERE ac.agent_id=r.design_agent_id AND ar.state IN ('running','unknown'))
            ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1`,[hostname()])).rows[0];
        if (candidate && (await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[candidate.project_id])).rows[0].locked)
        {
            if (!(await c.query("SELECT 1 FROM gameai.requirement_revisions WHERE project_id=$1 AND state IN ('running','unknown')",[candidate.project_id])).rowCount)
            {
                job=(await c.query("UPDATE gameai.requirement_revisions SET state='running',started_at=now() WHERE id=$1 AND state='queued' RETURNING *",[candidate.id])).rows[0];
                await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','原 Design 开始修订需求',$2)",[job.project_id,{revision_id:job.id,version_id:job.source_version_id,target_version:job.target_version}]);
            }
        }
        await c.query('COMMIT');
    }
    catch(error)
    {
        await c.query('ROLLBACK');
        throw error;
    }
    finally
    {
        c.release();
    }
    if (job) await runRequirementRevision(pool,job,execute);
}
