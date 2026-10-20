// Conservative classification: uncertain outcomes and human decisions never trigger execution.
export function recoveryAttempts(total, context)
{
    const verified=context?.verified_repair_budget;
    const verifiedStart=verified?.validated===true && /^[a-f0-9]{64}$/.test(verified.handlerFingerprint ?? '') && verified.max_attempts===3 ? verified.prior_attempts : undefined;
    if (Number.isInteger(verifiedStart) && verifiedStart>=0 && verifiedStart<=total) return total-verifiedStart;
    const start = context?.recovery_cycle?.prior_attempts;
    return Number.isInteger(start) && start >= 0 && start < total ? total - start : total;
}

export function recoveryDecision({state,error,failure,attempts,authorized})
{
    if (state !== 'failed') return {retry:false,code:'process_unconfirmed',reason:'执行是否停止尚未确认，等待核实'};
    // 'Blocked' is an agent verdict, not a permission decision. In particular,
    // preserving an approved layout must not be interpreted as requesting approval.
    const message = error ?? '';
    // Explicit skill diagnostics take precedence over technical words in the same report.
    const waitCode = /\bWAIT_DEVICE\b/.test(message) ? 'awaiting_device'
        : /\bWAIT_APPROVAL\b/.test(message) ? 'awaiting_decision'
        : /\bWAIT_DEPENDENCY\b/.test(message) ? 'awaiting_dependency'
        : /\bTOOL_UNAVAILABLE\b/.test(message) ? 'awaiting_environment' : null;
    if (waitCode) return {retry:false,code:waitCode,reason:'等待外部条件恢复：'+message};
    const humanGate = /权限不足|未授权|无权限|需要.{0,8}(人工|批准|审批|确认)|等待.{0,8}(人工|批准|审批)|请.{0,8}(确认|批准)|未经批准|未批准|需求版本|上游|复测目标|输入哈希|缺少完成凭据|真机验收/.test(message);
    if (humanGate) return {retry:false,code:/真机验收/.test(message)?'awaiting_device':/上游|复测目标/.test(message)?'awaiting_dependency':'awaiting_decision',reason:'需要人工确认、需求修订或前置任务修复：'+error};
    if (['UNITY_UNAVAILABLE','ENVIRONMENT_UNAVAILABLE'].includes(failure?.code)) return {retry:false,code:'awaiting_environment',reason:'等待执行环境恢复，恢复后核验原任务并继续'};
    if (['PLATFORM_GUARD_INVALID','CONTRACT_CONFLICT'].includes(failure?.code)) return {retry:false,code:'unclassified',reason:'平台输入或执行侧校验失败，需要宿主诊断并提供实际修复凭据'};
    if (failure?.code==='DECISION_REQUIRED') return {retry:false,code:'awaiting_decision',reason:'需要明确的需求决定：'+(error ?? '')};
    if (failure?.code==='UPSTREAM_INVALID') return {retry:false,code:'awaiting_dependency',reason:'等待前置交付修复：'+(error ?? '')};
    if (!authorized) return {retry:false,code:'awaiting_authorization',reason:'原 Agent 未获自动执行授权，等待人工重试'};
    if (attempts >= 3) return {retry:false,code:'retry_exhausted',reason:'已达到三次执行上限，停止自动修复'};
    if (failure)
    {
        const repairable=['DELIVERY_REGISTRATION_MISSING','DELIVERY_FILE_MISSING','DELIVERY_HASH_MISMATCH','DELIVERY_RECEIPT_CONFLICT','TASK_VALIDATION_FAILED'];
        if (!repairable.includes(failure.code)) return {retry:false,code:'unclassified',reason:'未识别的结构化失败，等待人工处理：'+failure.code};
        return {retry:true,code:'task_repair',reason:`交付校验 ${failure.code}；由原 Agent 修复并重试，第 ${attempts+1}/3 次执行`,failure};
    }
    // Only bounded, task-local technical repair is eligible. Unknown failures
    // remain paused; dispatch independently rechecks approval, grants and inputs.
    // Simulated input failures permit bounded diagnosis within the frozen contract only.
    const simulatedValidationFailure = /closeTips.{0,100}未命中|关闭按钮.{0,30}未命中|命中区域.{0,30}(越过|超出).{0,15}(边界|安全区)/.test(message);
    const technicalFailure = /进程未正常结束|执行结果|字段不完整|交付文件|检查证据|通过结论|专业交付检查|ENOENT|timeout|连接|超时|预览视域|深度适配|截图.{0,16}(遮罩|空白|失败)|预览.{0,16}(裁切|视域|失败)|九宫格.{0,16}(检查|验证).{0,8}(受阻|失败)|贴图导入参数/.test(message);
    if (!technicalFailure && !simulatedValidationFailure) return {retry:false,code:'unclassified',reason:'尚不能安全分类失败原因，等待人工处理：'+error};
    return {retry:true,code:'task_repair',reason:`由原 Agent 根据失败证据修复并重试，第 ${attempts+1}/3 次执行`};
}
