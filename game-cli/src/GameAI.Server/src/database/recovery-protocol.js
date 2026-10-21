import {createHash} from 'node:crypto';

export const recoveryProtocolVersion='agent-recovery/1';
export const recoveryInstructions=`运行恢复协议 agent-recovery/1（宿主执行规则，不改变已批准需求）：
执行前检查本角色工具、输入和依赖。先读取已有失败证据、修复交接和检查点，复现故障，再修复自身职责内的问题。
长任务在每个有意义步骤完成后保存已有产物及检查点到本次输入所在的中间目录；写明输入版本、已完成步骤、产物路径、验证证据、剩余步骤和下一动作。检查点仅作恢复线索，不代表任务完成。
恢复时复用宿主确认哈希未变的产物，重新执行失败步骤及受影响检查，最后通过原完整验收。不得原样重复命令、降低验收、修改审批或越过角色权限。
专业 execute 失败必须返回 failure.code、step、evidence_path、repair；证据文件列入 files。UPSTREAM_INVALID 的 source_task_key 只能是输入 dependencies 中实际有缺陷的任务编号，否则为 null。由服务交回原 Agent，不能自行派发或代做其他角色工作。
Design 和 PM 沿用各自结果 schema：技术故障应保留实际错误及可复用结果；真实需求决定使用 questions/needs_input，确定性文档问题使用 revision_required；不能把工具故障伪装成需求决定。
审批、凭据、业务取舍缺失时明确指出恢复条件；不能自批或猜测。服务负责持久化队列、有限重试、巡检和下游唤醒，Agent 不创建本地调度器。`;
export const recoveryProtocolHash=createHash('sha256').update(recoveryInstructions).digest('hex');

export function designExecutionIds(operationId)
{
    return Array.from({length:3},(_,attempt)=>['draft','review'].map(stage=>
        createHash('sha256').update(`${operationId}:${attempt}:${stage}`).digest('hex').slice(0,32))).flat();
}
