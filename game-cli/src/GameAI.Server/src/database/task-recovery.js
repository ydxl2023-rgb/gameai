// Conservative classification: uncertain outcomes and human decisions never trigger execution.
export function recoveryAttempts(total, context)
{
    const start = context?.recovery_cycle?.prior_attempts;
    return Number.isInteger(start) && start >= 0 && start < total ? total - start : total;
}

export function recoveryDecision({state,error,attempts,authorized})
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
    if (!authorized) return {retry:false,code:'awaiting_authorization',reason:'原 Agent 未获自动执行授权，等待人工重试'};
    if (attempts >= 3) return {retry:false,code:'retry_exhausted',reason:'已达到三次执行上限，停止自动修复'};
    // Only bounded, task-local technical repair is eligible. Unknown failures
    // remain paused; dispatch independently rechecks approval, grants and inputs.
    const technicalFailure = /进程未正常结束|执行结果|字段不完整|交付文件|检查证据|通过结论|专业交付检查|ENOENT|timeout|连接|超时|预览视域|深度适配|截图.{0,16}(遮罩|空白|失败)|预览.{0,16}(裁切|视域|失败)|九宫格.{0,16}(检查|验证).{0,8}(受阻|失败)|贴图导入参数/.test(message);
    if (!technicalFailure) return {retry:false,code:'unclassified',reason:'尚不能安全分类失败原因，等待人工处理：'+error};
    return {retry:true,code:'task_repair',reason:`由原 Agent 根据失败证据修复并重试，第 ${attempts+1}/3 次执行`};
}
