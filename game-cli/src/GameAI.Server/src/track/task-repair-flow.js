import {diagnoseRepair} from '../database/task-repairs.js';
import {repairGuardPreflight,probeUnity,repairToolFingerprint} from './task-preflight.js';
import {loadTaskContext,contextBlockReason} from '../database/qa-context.js';
import {isDeepStrictEqual} from 'node:util';
import {recoveryAttempts} from '../database/task-recovery.js';

async function probeDependencies(pool,row)
{
    const task=(await pool.query('SELECT * FROM gameai.tasks WHERE id=$1',[row.task_id])).rows[0];
    if (!task) return false;
    const context=await loadTaskContext(pool,task);
    if (await contextBlockReason(context,task)) return false;
    // Accepted dependencies alone do not prove that an explicitly reported
    // upstream defect was repaired. A new verified dependency version is needed.
    if (row.failure?.code==='UPSTREAM_INVALID' && isDeepStrictEqual(context.dependencies,row.context?.dependencies)) return false;
    return true;
}

export async function resumeTaskRepairs(pool,{guard=repairGuardPreflight,environment=probeUnity,dependency=probeDependencies,projectId=null}={})
{
    if (guard===repairGuardPreflight) await requeueToolRepairs(pool,projectId);
    // Atomic leases prevent another server or a restarted pump from diagnosing the same row.
    const rows=(await pool.query(`UPDATE gameai.task_repairs r SET state='diagnosing',lease_until=now()+interval '2 minutes',probes=probes+1,updated_at=now()
        WHERE execution_id IN (SELECT execution_id FROM gameai.task_repairs WHERE state IN ('pending','waiting','diagnosing')
            AND ($1::uuid IS NULL OR project_id=$1) AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING r.*`,[projectId])).rows;
    for (const row of rows)
    {
        try
        {
            const current=(await pool.query(`SELECT e.state execution_state,e.result->>'error' error,e.result->'failure' failure,j.context,
                t.status,t.dispatch_allowed,f.reason flow_reason,f.state flow_state,
                (SELECT id FROM gameai.executions WHERE task_id=t.id ORDER BY started_at DESC LIMIT 1) latest_execution_id,
                (SELECT count(*)::int FROM gameai.executions WHERE task_id=t.id) attempts,
                (a.auto_execute AND a.enabled AND t.dispatch_allowed AND (f.agent_policy IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.agent_policy) policy WHERE policy->>'id'=a.id::text AND policy->>'role_code'=t.role_code))) authorized
                FROM gameai.executions e JOIN gameai.tasks t ON t.id=e.task_id JOIN gameai.agents a ON a.id=e.agent_id
                JOIN gameai.plan_dispatch_flows f ON f.plan_version_id=t.plan_version_id LEFT JOIN gameai.task_dispatch_jobs j ON j.execution_id=e.id WHERE e.id=$1`,[row.execution_id])).rows[0];
            if (!current || current.latest_execution_id!==row.execution_id || ['completed','review'].includes(current.status))
            {
                await updateRepair(pool,row,'cancelled','已被后续执行替代或任务已完成');
                continue;
            }
            if (!['active','paused'].includes(current.flow_state) || (current.flow_state==='paused' && !current.flow_reason.startsWith('自动恢复处理中：') && current.flow_reason!==row.decision.reason))
            {
                await updateRepair(pool,row,'attention','流程由其他操作暂停，不自动覆盖该操作');
                continue;
            }
            const decision=diagnoseRepair({...row,...current});
            let receipt=null;
            let budget=null;
            if (decision.action==='guard')
            {
                receipt=await guard(pool,row);
                if (!receipt.applicable || !receipt.runtimeValidated) throw new Error('没有匹配当前冻结附件的执行侧校验凭据');
                if (recoveryAttempts(current.attempts,current.context)>=3)
                {
                    const seen=receipt.handlerFingerprint ? (await pool.query(`SELECT 1 FROM gameai.task_repairs WHERE task_id=$1 AND evidence->'budget'->>'handlerFingerprint'=$2`,[row.task_id,receipt.handlerFingerprint])).rowCount : 1;
                    if (seen || current.attempts>=9)
                    {
                        await updateRepair(pool,row,'attention','本工具版本的修复预算已用尽；需要新的可验证修复，不能重置次数');
                        continue;
                    }
                    budget={validated:true,prior_attempts:current.attempts,max_attempts:3,handlerFingerprint:receipt.handlerFingerprint};
                }
            }
            if (decision.action==='environment')
            {
                if (!/Unity|桥接|bridge|UNITY_UNAVAILABLE/i.test(current.error ?? ''))
                {
                    await updateRepair(pool,row,'attention','环境类型没有可用的探测器；需配置明确恢复条件');
                    continue;
                }
                if (!await environment())
                {
                    await updateRepair(pool,row,'waiting','等待Unity桥接恢复；每次只探测，不重复执行生产任务',null,Math.min(300,15*2**Math.min(row.probes,4)));
                    continue;
                }
                receipt={handler:'unity-ping',available:true};
            }
            if (decision.action==='dependency')
            {
                if (!await dependency(pool,{...row,...current}))
                {
                    await updateRepair(pool,row,'waiting','等待前置任务完成并通过交付核验；条件满足后自动继续',null,30);
                    continue;
                }
                receipt={handler:'dependency-check',available:true};
            }
            if (decision.action==='attention')
            {
                await updateRepair(pool,row,'attention',decision.reason);
                continue;
            }
            // Ready is a dispatch permit for this failed execution only. All normal
            // approval, dependency, capacity and fixed-role guards still run at dispatch.
            const resumed=await pool.query(`UPDATE gameai.plan_dispatch_flows f SET state='active',reason=$2,updated_at=now()
                WHERE f.plan_version_id=$1 AND f.state=$3 AND f.reason=$4
                AND EXISTS(SELECT 1 FROM gameai.executions e JOIN gameai.tasks t ON t.id=e.task_id JOIN gameai.agents a ON a.id=e.agent_id
                    WHERE e.id=$5 AND e.state='failed' AND t.status='failed' AND t.dispatch_allowed AND a.auto_execute AND a.enabled
                    AND NOT EXISTS(SELECT 1 FROM gameai.executions n WHERE n.task_id=t.id AND n.started_at>e.started_at))`,[row.plan_version_id,'自动恢复处理中：'+decision.reason,current.flow_state,current.flow_reason,row.execution_id]);
            if (!resumed.rowCount)
            {
                await updateRepair(pool,row,'cancelled','诊断期间流程、执行状态或授权改变，取消本次恢复');
                continue;
            }
            await pool.query(`UPDATE gameai.task_repairs SET state='ready',code=$2,decision=$3,evidence=evidence||$4::jsonb,lease_until=NULL,next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE execution_id=$1`,[row.execution_id,decision.code,decision,JSON.stringify({receipt,budget})]);
            if (budget) await pool.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','验证通过的工具修复开启有限恢复预算',$2)`,[row.project_id,{task_id:row.task_id,execution_id:row.execution_id,budget,receipt}]);
            await pool.query(`INSERT INTO gameai.workflow_outbox(event_key,plan_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,['repair:'+row.execution_id,row.plan_version_id]);
        }
        catch (error)
        {
            const wait=error.code==='UNITY_UNAVAILABLE';
            await updateRepair(pool,row,wait ? 'waiting' : 'attention',error.message,{handlerError:error.message},30);
        }
    }
}

async function requeueToolRepairs(pool,projectId)
{
    const fingerprint=await repairToolFingerprint();
    const rows=(await pool.query(`SELECT r.*,e.result->>'error' error FROM gameai.task_repairs r
        JOIN gameai.executions e ON e.id=r.execution_id JOIN gameai.tasks t ON t.id=r.task_id
        JOIN gameai.agents a ON a.id=e.agent_id JOIN gameai.plan_dispatch_flows f ON f.plan_version_id=r.plan_version_id
        WHERE r.state='attention' AND ($1::uuid IS NULL OR r.project_id=$1) AND e.state='failed' AND t.status='failed'
        AND a.enabled AND a.auto_execute AND t.dispatch_allowed
        AND (e.result->'failure'->>'code' IN ('UPSTREAM_INVALID','CONTRACT_CONFLICT','PLATFORM_GUARD_INVALID'))
        AND (e.result->>'error') ~ '装配参数|装配清单|历史贴图|历史条目|CONTRACT_CONFLICT'
        AND NOT EXISTS(SELECT 1 FROM gameai.executions n WHERE n.task_id=t.id AND n.started_at>e.started_at)
        AND f.state='paused' AND (f.reason=r.decision->>'reason' OR f.reason='自动修复需要处理：'||(r.decision->>'reason'))
        AND COALESCE(r.evidence->>'lastHandlerFingerprint','')<>$2 ORDER BY r.updated_at LIMIT 10`,[projectId,fingerprint])).rows;
    for (const row of rows)
    {
        await pool.query(`UPDATE gameai.task_repairs SET state='pending',lease_until=NULL,next_attempt_at=now(),
            evidence=evidence||jsonb_build_object('lastHandlerFingerprint',$2::text),updated_at=now()
            WHERE execution_id=$1 AND state='attention'`,[row.execution_id,fingerprint]);
        await pool.query(`UPDATE gameai.plan_dispatch_flows SET reason=$2,updated_at=now() WHERE plan_version_id=$1 AND state='paused'
            AND (reason=$3 OR reason='自动修复需要处理：'||$3)`,[row.plan_version_id,'自动恢复处理中：'+row.decision.reason,row.decision.reason]);
        await pool.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','检测到新的平台修复版本，重新核验恢复条件',$2)`,[row.project_id,{task_id:row.task_id,execution_id:row.execution_id,handlerFingerprint:fingerprint}]);
    }
}

async function updateRepair(pool,row,state,reason,evidence=null,delay=30)
{
    await pool.query(`UPDATE gameai.task_repairs SET state=$2,decision=decision||jsonb_build_object('reason',$3::text),evidence=evidence||$4::jsonb,
        lease_until=NULL,next_attempt_at=now()+$5*interval '1 second',updated_at=now() WHERE execution_id=$1`,[row.execution_id,state,reason,JSON.stringify(evidence ?? {}),delay]);
    await pool.query(`UPDATE gameai.plan_dispatch_flows SET reason=$2,updated_at=now() WHERE plan_version_id=$1 AND state='paused' AND (reason LIKE '自动恢复处理中：%' OR reason=$3)`,[row.plan_version_id,(state==='attention' ? '自动修复需要处理：' : '自动恢复处理中：')+reason,row.decision.reason]);
    if (state==='attention') await pool.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','自动修复需要处理',$2)`,[row.project_id,{execution_id:row.execution_id,task_id:row.task_id,reason}]);
}
