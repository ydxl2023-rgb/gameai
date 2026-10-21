import {verifyTaskFiles} from './task-files.js';

export async function requestUpstreamRepair(pool,row)
{
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[row.project_id]);
        const current=(await c.query(`SELECT f.* FROM gameai.plan_dispatch_flows f
            JOIN gameai.tasks t ON t.plan_version_id=f.plan_version_id JOIN gameai.executions e ON e.task_id=t.id
            JOIN gameai.agents a ON a.id=e.agent_id
            JOIN gameai.plan_versions pv ON pv.id=f.plan_version_id
            JOIN gameai.requirement_versions v ON v.id=pv.requirement_version_id
            WHERE e.id=$1 AND e.state='failed' AND t.status='failed' AND t.dispatch_allowed AND a.enabled AND a.auto_execute
            AND pv.state='published' AND EXISTS(SELECT 1 FROM gameai.approvals WHERE version_id=v.id AND decision='approved')
            AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions n WHERE n.requirement_id=v.requirement_id AND n.ordinal>v.ordinal)
            AND (f.agent_policy IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.agent_policy) p WHERE p->>'id'=a.id::text AND p->>'role_code'=t.role_code))
            AND NOT EXISTS(SELECT 1 FROM gameai.executions n WHERE n.task_id=t.id AND n.started_at>e.started_at)
            FOR UPDATE OF f`,[row.execution_id])).rows[0];
        if (!current || !['active','paused'].includes(current.state) ||
            (current.state==='paused' && !current.reason.startsWith('自动恢复处理中：') && current.reason!==row.decision.reason))
        {
            await c.query('ROLLBACK');
            return {attention:true,reason:'交接期间流程或授权已改变，取消本次自动交接'};
        }
        const receipt=await handoffUpstreamRepair(c,row);
        if (receipt.handedOff)
        {
            await c.query("UPDATE gameai.plan_dispatch_flows SET state='active',reason=$2,updated_at=now() WHERE plan_version_id=$1",[row.plan_version_id,receipt.reason]);
            await c.query(`INSERT INTO gameai.workflow_outbox(event_key,plan_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,['handoff:'+row.execution_id,row.plan_version_id]);
        }
        await c.query('COMMIT');
        return receipt;
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
}

// This runs inside the caller's project transaction/lock. A model names a dependency;
// the service independently proves its identity, consent, evidence and current version.
export async function handoffUpstreamRepair(c,row)
{
    const detail=row.failure?.items?.[0];
    if (row.failure?.code!=='UPSTREAM_INVALID' || !detail?.source_task_key)
    {
        return {waiting:true,reason:'等待前置交付的新版本；缺少可核验的具体上游任务，不自动改派'};
    }
    const source=(await c.query(`SELECT s.*,a.enabled,a.auto_execute,f.agent_id fixed_agent_id,
        e.id source_execution_id,e.agent_id source_agent_id,e.result->'artifacts' artifacts,
        (SELECT count(*)::int FROM gameai.executions x WHERE x.task_id=s.id) attempts
        FROM gameai.task_dependencies d JOIN gameai.tasks s ON s.id=d.depends_on_id
        JOIN gameai.executions e ON e.task_id=s.id AND e.state='succeeded'
        JOIN gameai.agents a ON a.id=e.agent_id
        LEFT JOIN gameai.fixed_agents f ON f.project_id=s.project_id AND f.role_code=s.role_code
        WHERE d.task_id=$1 AND s.task_key=$2 AND s.plan_version_id=$3
        ORDER BY e.started_at DESC LIMIT 1`,[row.task_id,detail.source_task_key,row.plan_version_id])).rows[0];
    if (!source || !['Prefab','Art','Development','QA'].includes(source.role_code))
    {
        return {attention:true,reason:'返修来源不是本任务的直接、可追溯专业依赖；需要明确来源'};
    }
    const original=row.context?.dependencies?.find(d=>d.id===source.id);
    const evidence=(row.result?.artifacts ?? []).find(a=>a.path===detail.evidence_path);
    if (!original || original.execution_id!==source.source_execution_id || !evidence || !await verifyTaskFiles([evidence]))
    {
        return {attention:true,reason:'上游交付版本或缺陷证据不能核验，拒绝用过期报告重新打开任务'};
    }
    const policy=(await c.query('SELECT agent_policy FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[row.plan_version_id])).rows[0]?.agent_policy;
    if (!source.dispatch_allowed || !source.enabled || !source.auto_execute || source.fixed_agent_id!==source.source_agent_id ||
        (policy && !policy.some(a=>a.id===source.source_agent_id && a.role_code===source.role_code)))
    {
        return {attention:true,reason:'原上游 Agent 或任务未获自动执行授权；保留交接证据，等待恢复授权'};
    }
    const prior=(await c.query('SELECT * FROM gameai.upstream_repairs WHERE requesting_execution_id=$1 AND source_task_id=$2',[row.execution_id,source.id])).rows[0];
    if (prior)
    {
        return {waiting:true,handedOff:true,reason:'已交回原上游 Agent；等待原任务交付新版本并由下游复验'};
    }
    if (source.attempts>=3)
    {
        return {attention:true,reason:'上游原任务修复预算已用尽，需要可验证的新修复方案；保留原执行历史'};
    }
    if (!['completed','review'].includes(source.status))
    {
        return {waiting:true,reason:'原上游任务正在执行或修复，等待其新交付'};
    }
    await c.query(`INSERT INTO gameai.upstream_repairs(project_id,plan_version_id,requesting_execution_id,requesting_task_id,
        source_task_id,source_execution_id,source_agent_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(requesting_execution_id,source_task_id) DO NOTHING`,
    [row.project_id,row.plan_version_id,row.execution_id,row.task_id,source.id,source.source_execution_id,source.source_agent_id,detail]);
    await c.query("UPDATE gameai.tasks SET status='pending',progress=0,bound_agent_id=$2 WHERE id=$1",[source.id,source.source_agent_id]);
    // Known defective inputs invalidate completed descendants. The original graph is unchanged.
    await c.query(`WITH RECURSIVE downstream(id) AS (
        SELECT task_id FROM gameai.task_dependencies WHERE depends_on_id=$1
        UNION SELECT d.task_id FROM gameai.task_dependencies d JOIN downstream s ON d.depends_on_id=s.id)
        UPDATE gameai.tasks SET status='blocked',progress=0 WHERE id IN(SELECT id FROM downstream) AND status IN('completed','review')`,[source.id]);
    await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','下游缺陷交回原上游 Agent',$2)`,
    [row.project_id,{requesting_task_id:row.task_id,source_task_id:source.id,source_execution_id:source.source_execution_id,agent_id:source.source_agent_id,evidence}]);
    return {waiting:true,handedOff:true,reason:'已交回原上游 Agent；修复沿用原任务、契约和验收，交付后自动唤醒下游复验'};
}

export async function finishUpstreamRepair(c,task,executionId)
{
    const changed=await c.query(`UPDATE gameai.upstream_repairs SET state='repaired',repaired_execution_id=$2,updated_at=now()
        WHERE source_task_id=$1 AND state='open' AND source_execution_id<>$2 RETURNING requesting_execution_id`,[task.id,executionId]);
    for (const row of changed.rows)
    {
        await c.query(`UPDATE gameai.task_repairs SET next_attempt_at=now(),updated_at=now()
            WHERE execution_id=$1 AND state='waiting'`,[row.requesting_execution_id]);
    }
    // Repaired means only the upstream acceptance passed. The consumer must still
    // rerun its failed checks before the handoff can be called verified.
    await c.query(`UPDATE gameai.upstream_repairs SET state='verified',updated_at=now()
        WHERE requesting_task_id=$1 AND state='repaired'`,[task.id]);
}
