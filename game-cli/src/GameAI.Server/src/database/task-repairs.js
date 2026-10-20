import {createHash} from 'node:crypto';
import {recoveryDecision,recoveryAttempts} from './task-recovery.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function repairScopeHash(task,context,contractHash)
{
    // Retry prompts contain new failure history; they are never a new production scope.
    return hash({contract:contractHash ?? null,revision:task.content_revision ?? 0,description:task.description,criteria:task.delivery_criteria,dependencies:context?.dependencies ?? []});
}

export function repairIdentity(error,failure,context,result)
{
    // Stable check names beat prose containing dates and execution identifiers.
    let content;
    try { content=JSON.parse(result?.Text ?? '{}'); } catch { content={}; }
    const checks=(content.checks ?? []).filter(check=>!check.passed).map(check=>check.name).sort();
    const message=(error ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<id>').replace(/第\s*\d+\s*\/\s*\d+\s*次/g,'<attempt>');
    const structured=!!failure?.code && failure.code!=='TASK_VALIDATION_FAILED';
    return {
        fingerprint:hash({code:failure?.code ?? '',checks:structured ? [] : checks,error:structured || checks.length ? '' : message,input:context?.repair_input_hash ?? context?.input_hash ?? '',handler:context?.repair_handler_fingerprint ?? ''}),
        progress_hash:hash((result?.artifacts ?? []).filter(item=>/^(?:app\/client\/)?Assets\//.test(item.path ?? item.storage_key ?? '')).map(item=>[item.path ?? item.storage_key,item.sha256]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))
    };
}

export async function enqueueTaskRepair(c,task,executionId,decision,{error,failure,context,result})
{
    const identity=repairIdentity(error,failure,context,result);
    const repeated=(await c.query(`SELECT 1 FROM gameai.task_repairs WHERE task_id=$1 AND fingerprint=$2 AND progress_hash=$3 AND execution_id<>$4 LIMIT 1`,[task.id,identity.fingerprint,identity.progress_hash,executionId])).rowCount>0;
    const actionable=decision.retry || ['unclassified','awaiting_environment','awaiting_dependency'].includes(decision.code) || /CONTRACT_CONFLICT/.test(error ?? '');
    const state=repeated || !actionable ? 'attention' : 'pending';
    const value=repeated ? {...decision,retry:false,code:'no_progress',reason:'相同输入和失败检查再次出现，且没有新产物证据；停止重复执行，等待针对性修复。'} : decision;
    const saved=await c.query(`INSERT INTO gameai.task_repairs(execution_id,project_id,task_id,plan_version_id,state,code,fingerprint,progress_hash,decision,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(execution_id) DO UPDATE
        SET state=EXCLUDED.state,code=EXCLUDED.code,fingerprint=EXCLUDED.fingerprint,progress_hash=EXCLUDED.progress_hash,
            decision=EXCLUDED.decision,evidence=EXCLUDED.evidence,next_attempt_at=now(),lease_until=NULL,updated_at=now()
        WHERE task_repairs.code='process_unconfirmed' RETURNING state,decision`,
    [executionId,task.project_id,task.id,task.plan_version_id,state,value.code,identity.fingerprint,identity.progress_hash,value,{error,failure,input_hash:context?.input_hash ?? null,lastHandlerFingerprint:context?.verified_repair_budget?.handlerFingerprint ?? null}]);
    return saved.rows[0] ?? (await c.query('SELECT state,decision FROM gameai.task_repairs WHERE execution_id=$1',[executionId])).rows[0];
}

export function diagnoseRepair(row)
{
    const decision=recoveryDecision({state:row.execution_state,error:row.error,failure:row.failure,attempts:recoveryAttempts(row.attempts,row.context),authorized:row.authorized});
    if (!row.authorized || row.execution_state!=='failed')
    {
        return {action:'attention',...decision};
    }
    if (['awaiting_decision','awaiting_device','awaiting_authorization'].includes(decision.code)) return {action:'attention',...decision};
    if (/装配清单|装配参数|历史条目|历史贴图|visualTextures/.test(row.error ?? '') && ['UPSTREAM_INVALID','CONTRACT_CONFLICT'].includes(row.failure?.code))
    {
        return {action:'guard',code:'platform_manifest',reason:'宿主按冻结槽位与已验收Art清单生成受保护的资源投影，并执行正式装配预检；保留原批准内容。'};
    }
    if (recoveryAttempts(row.attempts,row.context)>=3)
    {
        return {action:'attention',...decision};
    }
    if (decision.retry) return {action:'retry',...decision};
    if (decision.code==='unclassified' && (/CONTRACT_CONFLICT/.test(row.error ?? '') || ['PLATFORM_GUARD_INVALID','CONTRACT_CONFLICT'].includes(row.failure?.code)))
    {
        return {action:'guard',code:'platform_guard',reason:'由宿主用实际工具重新核验冻结附件；不改变审批或制作目标。'};
    }
    if (decision.code==='awaiting_environment')
    {
        return {action:'environment',...decision};
    }
    if (decision.code==='awaiting_dependency') return {action:'dependency',...decision};
    if (decision.code==='unclassified')
    {
        return {action:'retry',retry:true,code:'diagnostic_repair',reason:'原 Agent 执行一次有界诊断与任务内修复；必须复现失败、保留有效产物并提供修复证据，禁止原样重跑或修改批准目标。'};
    }
    return {action:'attention',...decision};
}
