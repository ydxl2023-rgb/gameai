import { Button, Tooltip } from 'antd';
import type { RequirementRow } from './model';

export function PmSplitButton({ row, allowed, busy, start }: { row:RequirementRow; allowed:boolean; busy:boolean; start:()=>void })
{
    const state = row.pm_job?.state;
    const limit = (row.pm_job?.attempts ?? 0) >= 3;
    const locked = !allowed || row.status !== '已批准' || busy || state === 'running' || state === 'completed' || state === 'unknown' || limit;
    const label = state === 'running' ? 'PM 拆分中' : state === 'completed' ? `已拆分 ${row.pm_job?.task_count ?? 0} 项` : state === 'unknown' ? '执行待核实' : state === 'failed' ? '重试 PM 拆分' : 'PM 拆分任务';
    const hint = row.pm_job?.error || (state === 'unknown' ? '执行结果不确定，请核实 PM 会话与服务器记录，不能直接重试。' : !allowed ? '请在本机工作台登录人工审批账户。' : row.status !== '已批准' ? '需求须先人工批准。' : limit ? '已达到 3 次尝试上限。' : '由固定 PM 拆分美术与程序子任务，保留交付标准和依赖；不会启动制作或开发。');
    return <Tooltip title={hint}><span><Button type="link" disabled={locked} loading={busy || state === 'running'} onClick={start}>{label}</Button></span></Tooltip>;
}
