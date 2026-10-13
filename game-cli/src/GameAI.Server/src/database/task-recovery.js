// Conservative classification: uncertain outcomes and human decisions never trigger execution.
export function recoveryDecision({state,error,attempts,authorized})
{
    if (state !== 'failed') return {retry:false,reason:'执行是否停止尚未确认，等待核实'};
    if (/阻塞|权限|批准|需求版本|上游|复测目标|输入哈希|凭据/.test(error ?? '')) return {retry:false,reason:'需要人工确认、需求修订或前置任务修复：'+error};
    if (!authorized) return {retry:false,reason:'原 Agent 未获自动执行授权，等待人工重试'};
    if (attempts >= 3) return {retry:false,reason:'已达到三次执行上限，停止自动修复'};
    if (!/进程未正常结束|执行结果|字段不完整|交付文件|检查证据|通过结论|专业交付检查|ENOENT|timeout|连接|超时/i.test(error ?? '')) return {retry:false,reason:'尚不能安全分类失败原因，等待人工处理：'+error};
    return {retry:true,reason:`由原 Agent 根据失败证据修复并重试，第 ${attempts+1}/3 次执行`};
}
