const states = {pending:'待调度',blocked:'依赖阻塞',running:'执行中',review:'待验收',completed:'已完成',failed:'失败',cancelled:'已取消'};
const waiting = {awaiting_device:'等待设备',awaiting_decision:'等待审批',awaiting_dependency:'等待上游',awaiting_environment:'等待工具',awaiting_authorization:'等待授权'};

export function taskDisplayState(task)
{
    // A historical failure must not override a later review or completion.
    if (task.execution_state === 'unknown') return '待核实';
    if (task.status === 'failed' && waiting[task.recovery?.code]) return waiting[task.recovery.code];
    return states[task.status];
}
