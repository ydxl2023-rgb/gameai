import { Button, Tooltip } from 'antd';
import type { RequirementRow } from './model';

export function PmSplitButton({ row, allowed, busy, start }: { row:RequirementRow; allowed:boolean; busy:boolean; start:()=>void })
{
    const state = row.pm_job?.state;
    const correction = row.pm_job?.correction;
    const correctionLabels:Record<string,string> = {queued:'等待 Design 修订',running:'Design 修订中',awaiting_approval:'新版本待审批',needs_input:'待人工澄清',failed:'修订执行失败',unknown:'修订待核实',superseded:'已有新版本'};
    const limit = (row.pm_job?.attempts ?? 0) >= 3;
    const locked = state === 'revision_required' || !allowed || row.status !== '已批准' || busy || state === 'running' || state === 'completed' || state === 'unknown' || limit;
    const label = state === 'revision_required' ? (correctionLabels[correction?.state ?? ''] ?? '需求待修订') : state === 'running' ? 'PM 拆分中' : state === 'completed' ? `已拆分 ${row.pm_job?.task_count ?? 0} 项` : state === 'unknown' ? '执行待核实' : state === 'failed' ? '重试 PM 拆分' : 'PM 拆分任务';
    const hint = [correction?.error,row.pm_job?.error].filter(Boolean).join('\n') || (state === 'unknown' ? '执行结果不确定，请核实 PM 会话与服务器记录，不能直接重试。' : !allowed ? '请在本机工作台登录人工审批账户。' : row.status !== '已批准' ? '需求须先人工批准。' : limit ? '已达到 3 次尝试上限。' : '由固定 PM 拆分白模、美术资源与预制装配任务，保留交付标准和依赖；不会启动制作或开发。');
    return <><Tooltip title={hint}><span><Button type="link" disabled={locked} loading={busy || state === 'running'} onClick={start}>{label}</Button></span></Tooltip>{state === 'revision_required' && <div style={{maxWidth:520,whiteSpace:'pre-wrap',fontSize:13}}>{correction?.error || correction?.report.summary || row.pm_job?.error}</div>}</>;
}
