import {designExecutionIds} from '../database/recovery-protocol.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tempRoot} from '../paths.js';
import {runRequirementRevision} from './requirement-revision-flow.js';
import {dispatchPmJob} from './pm-dispatch.js';

// Design/PM do not use specialist tasks. Their durable owners remain the original
// revision/job; retries never create a new approval or reset their lifetime budget.
export async function resumeRoleJobs(pool,{projectId=null}={})
{
    const candidates=(await pool.query(`SELECT 'Design' role,r.id,r.project_id FROM gameai.requirement_revisions r
        WHERE r.state IN ('failed','unknown','running') AND r.submission IS NULL AND r.recovery_execution_id IS NOT NULL
        AND r.recovery_at<=now() AND ($1::uuid IS NULL OR r.project_id=$1)
        UNION ALL SELECT 'PM',j.id,j.project_id FROM gameai.pm_jobs j
        WHERE j.state IN ('failed','unknown','running') AND j.publication_result IS NULL
        AND j.recovery_agent_id IS NOT NULL AND j.recovery_code<>'publication'
        AND j.recovery_at<=now() AND ($1::uuid IS NULL OR j.project_id=$1) LIMIT 30`,[projectId])).rows;
    for (const candidate of candidates)
    {
        const c=await pool.connect();
        let restore;
        try
        {
            await c.query('BEGIN');
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[candidate.project_id]);
            restore=await recoverRoleJob(c,candidate);
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
        if (restore)
        {
            // Replay through the original validators; no model invocation or new attempt.
            if (restore.role==='PM')
            {
                await dispatchPmJob(pool,restore.projectKey,{job:restore.job,document:restore.document},
                    async()=>({code:0,diagnostics:'恢复原 PM 已保存结果',output:restore.response}),{recoverPublication:true});
                await pool.query(`UPDATE gameai.pm_jobs SET recovery_code='replay_failed' WHERE id=$1 AND state IN ('failed','unknown')`,[restore.job.id]);
            }
            else
            {
                await runRequirementRevision(pool,restore.job,async()=>({code:0,diagnostics:'恢复原 Design 已保存结果',output:restore.response}));
                await pool.query("UPDATE gameai.requirement_revisions SET recovery_code='replay_failed' WHERE id=$1 AND state='failed'",[restore.job.id]);
            }
        }
    }
}

async function recoverRoleJob(c,candidate)
{
    const design=candidate.role==='Design';
    const table=design ? 'requirement_revisions' : 'pm_jobs';
    const job=(await c.query(`SELECT *,${design ? "started_at<now()-interval '20 minutes'" : 'expires_at<now()'} expired
        FROM gameai.${table} WHERE id=$1 FOR UPDATE`,[candidate.id])).rows[0];
    if (!job || !['failed','unknown','running'].includes(job.state) || job.submission || job.publication_result)
    {
        return;
    }
    if (job.state==='running' && !job.expired)
    {
        return;
    }
    const ids=design ? designExecutionIds(job.recovery_execution_id) : [job.execution_id];
    const proof=(await c.query(`SELECT r.*,s.agent_id FROM gameai.agent_runs r
        JOIN gameai.agent_conversations s ON s.id=r.conversation_id
        WHERE r.execution_id=ANY($1::text[]) OR r.execution_id IN(SELECT execution_id FROM gameai.pm_stages WHERE parent_execution_id=ANY($1::text[]))`,[ids])).rows;
    if (proof.some(r=>!['completed','failed'].includes(r.state)) || (!proof.length && !job.expired && job.state!=='failed'))
    {
        return;
    }
    const agentId=design ? job.design_agent_id : job.recovery_agent_id;
    const enabled=(await c.query(`SELECT 1 FROM gameai.fixed_agents f JOIN gameai.agents a ON a.id=f.agent_id
        WHERE f.project_id=$1 AND f.role_code=$2 AND f.agent_id=$3 AND a.enabled AND a.auto_execute`,[job.project_id,candidate.role,agentId])).rowCount;
    if (!enabled || proof.some(p=>p.agent_id!==agentId))
    {
        return;
    }
    if (design && job.recovery_code!=='replay_failed')
    {
        try
        {
            const response=await readFile(join(tempRoot,'design',job.recovery_execution_id,'response.json'),'utf8');
            const parsed=JSON.parse(response);
            if (parsed.status==='draft_saved' || parsed.questions?.length)
            {
                await c.query("UPDATE gameai.requirement_revisions SET state='running' WHERE id=$1",[job.id]);
                return {job:{...job,state:'running'},response};
            }
        }
        catch (error)
        {
            if (error.code!=='ENOENT')
            {
                await attention(c,job,candidate.role,'原 Design 结果缓存损坏：'+error.message);
                return;
            }
        }
    }
    if (!design && job.recovery_code!=='replay_failed' && proof.some(r=>r.execution_id===job.execution_id && r.state==='completed'))
    {
        try
        {
            const response=await readFile(join(tempRoot,'pm-jobs',job.execution_id,'agent-output.json'),'utf8');
            JSON.parse(response);
            const document=(await c.query(`SELECT v.*,r.requirement_key,r.title,p.project_key,d.bytes FROM gameai.requirement_versions v
                JOIN gameai.requirements r ON r.id=v.requirement_id JOIN gameai.projects p ON p.id=v.project_id
                JOIN gameai.artifact_links l ON l.requirement_version_id=v.id JOIN gameai.artifacts a ON a.id=l.artifact_id
                JOIN gameai.document_contents d ON d.artifact_id=a.id WHERE v.id=$1 AND a.media_type='text/html'`,[job.requirement_version_id])).rows[0];
            if (document)
            {
                await c.query("UPDATE gameai.pm_jobs SET state='failed',recovery_at=now()+interval '30 seconds' WHERE id=$1",[job.id]);
                return {role:'PM',job:{...job,state:'failed'},response,projectKey:document.project_key,document:{...document,html:document.bytes.toString('utf8')}};
            }
        }
        catch (error)
        {
            if (error.code!=='ENOENT' && !(error instanceof SyntaxError))
            {
                await attention(c,job,candidate.role,'原 PM 结果缓存不可读取：'+error.message);
                return;
            }
        }
    }
    if ((design ? job.recovery_attempts : job.attempts)>=3)
    {
        await attention(c,job,candidate.role,'原角色恢复预算已用尽；保留检查点和执行历史，需要新的可验证修复');
        return;
    }
    const versionId=design ? job.source_version_id : job.requirement_version_id;
    const latest=(await c.query(`SELECT 1 FROM gameai.requirement_versions v WHERE v.id=$1
        AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions n WHERE n.requirement_id=v.requirement_id AND n.ordinal>v.ordinal)`,[versionId])).rowCount;
    if (!latest)
    {
        return;
    }
    if (design)
    {
        await c.query(`UPDATE gameai.requirement_revisions SET state='queued',recovery_at=now()+interval '30 seconds',
            recovery_history=recovery_history||jsonb_build_array(jsonb_build_object('execution_id',recovery_execution_id,'error',error,'state',state)),
            recovery_code='resuming' WHERE id=$1`,[job.id]);
    }
    else
    {
        // The stored human workflow, its exact role policy and current consent are
        // required; a manually launched PM does not silently become automatic.
        const workflow=(await c.query(`SELECT * FROM gameai.approval_workflows WHERE version_id=$1 AND state IN ('failed','pm') FOR UPDATE`,[versionId])).rows[0];
        if (!workflow || (workflow.agent_policy && !workflow.agent_policy.some(a=>a.id===agentId && a.role_code==='PM')))
        {
            return;
        }
        await c.query("UPDATE gameai.pm_jobs SET state='failed',recovery_code='resuming',recovery_at=now()+interval '30 seconds' WHERE id=$1",[job.id]);
        await c.query("UPDATE gameai.approval_workflows SET state='queued',error='',updated_at=now() WHERE version_id=$1",[versionId]);
    }
    await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','原角色恢复执行已入队',$2)`,
    [job.project_id,{role:candidate.role,job_id:job.id,version_id:versionId,error:job.error,prior_attempts:design ? job.recovery_attempts : job.attempts}]);
}

async function attention(c,job,role,reason)
{
    const table=role==='Design' ? 'requirement_revisions' : 'pm_jobs';
    await c.query(`UPDATE gameai.${table} SET recovery_at=now()+interval '5 minutes' WHERE id=$1`,[job.id]);
    await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload)
        SELECT $1,'orchestrator','角色恢复需要维护处理',$2::jsonb WHERE NOT EXISTS(
            SELECT 1 FROM gameai.audit_events WHERE project_id=$1 AND event='角色恢复需要维护处理' AND payload->>'job_id'=$3)`,
    [job.project_id,{role,job_id:job.id,reason,owner:'platform-maintainer',next_action:'修复已记录根因并提供验证凭据；不清除历史或原样重试'},job.id]);
}
