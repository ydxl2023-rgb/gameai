import { Card, Table, Tag, Button, Checkbox, Tooltip } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import type { ColumnsType } from 'antd/es/table';
import type { Agent, Task } from './model';
import { groupTaskTree, expandableTaskKeys, type TaskNode } from './task-tree';
import { ResizableHeader } from './ResizableHeader';

const taskColumnDefaults = [160,240,128,100,108,118,90];
const taskColumnMinimums = [160,120,100,72,90,105,80];
const taskWidthStorage = 'gameai.track.task-column-widths.v1';
function readTaskWidths():number[]
{
    try
    {
        const saved:unknown = JSON.parse(localStorage.getItem(taskWidthStorage) ?? 'null');
        if (Array.isArray(saved) && saved.length === taskColumnDefaults.length && saved.every((width,index)=>Number.isFinite(width) && width>=taskColumnMinimums[index] && width<=800)) return saved;
    }
    catch { /* Storage may be unavailable in an embedded host. */ }
    return [...taskColumnDefaults];
}
export function StateTag({ value }: { value: string })
{
    return <Tag color={['执行中', '已批准', '空闲'].includes(value) ? 'green' : ['待审批', '依赖阻塞', '等待交付', '退回修改'].includes(value) ? 'gold' : undefined}>{value}</Tag>;
}
export function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode })
{
    return <Card size="small" title={title} extra={extra} className="section">{children}</Card>;
}
export function AgentTable({ agents, select }: { agents: Agent[]; select: (agent: Agent) => void })
{
    const columns: ColumnsType<Agent> = [
        { title: 'Agent', dataIndex: 'id', render: (id, a) => <><Button type="link" title={id} onClick={() => select(a)}>{a.name ?? id}</Button>{a.fixed && <Tag color="blue">固定</Tag>}</> },
        { title: 'Role', dataIndex: 'role' },
        { title: 'Skills', ellipsis: true, render: (_, a) => a.skills?.map(s => s.key).join('、') || '未配置' },
        { title: 'Status', dataIndex: 'status', render: s => <StateTag value={s} /> },
        { title: 'Task', dataIndex: 'task', render: t => t ?? '—' },
        { title: 'Capacity', render: (_, a) => `${a.used} / ${a.capacity}` },
    ];
    return <Table size="small" rowKey="id" dataSource={agents} columns={columns} pagination={false} scroll={{ x: 750 }} locale={{ emptyText: '当前没有符合条件的 Agent' }} />;
}
export function TaskLinks({ ids, tasks, select }: { ids: string[]; tasks: Task[]; select: (task: Task) => void })
{
    if (!ids.length) return <>无</>;
    return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        {ids.map(id =>
        {
            const target = tasks.find(task => task.id === id);
            return <Button key={id} type="link" disabled={!target} title={target?.title ?? '任务未加载'}
                style={{ padding: 0, height: 'auto', whiteSpace: 'nowrap', textAlign: 'left', fontFamily: 'monospace' }}
                onClick={() => { if (target) select(target); }}>{id}</Button>;
        })}
    </div>;
}
export function TaskTable({ tasks, allTasks = tasks, select, canSelectDispatch = false, savingTask, setDispatch }: {
    tasks: Task[]; allTasks?: Task[]; select: (task: Task) => void; canSelectDispatch?:boolean;
    savingTask?:string; setDispatch?:(task:Task,allowed:boolean)=>void;
})
{
    const [filters,setFilters] = useState({role:[] as string[],status:[] as string[]});
    const [expanded,setExpanded] = useState<React.Key[]>([]);
    const [widths,setWidths] = useState(readTaskWidths);
    useEffect(()=>
    {
        try { localStorage.setItem(taskWidthStorage,JSON.stringify(widths)); }
        catch { /* Resizing still works when the host disallows persistence. */ }
    },[widths]);
    const searchedIds = new Set(tasks.map(t => t.id));
    const byId = new Map(allTasks.map(t => [t.id,t]));
    const searchScope = allTasks.filter(task =>
    {
        const seen = new Set<string>();
        let current:Task | undefined = task;
        while (current && !seen.has(current.id))
        {
            if (searchedIds.has(current.id)) return true;
            seen.add(current.id);
            current = current.parent_id ? byId.get(current.parent_id) : undefined;
        }
        return false;
    });
    const matches = searchScope.filter(t => (!filters.role.length || filters.role.includes(t.role)) && (!filters.status.length || filters.status.includes(t.status)));
    const tree = groupTaskTree(matches,allTasks);
    const filtered = tasks.length !== allTasks.length || filters.role.length > 0 || filters.status.length > 0;
    const filterKey = filtered ? matches.map(t => t.id).join('|') : '';
    useEffect(() =>
    {
        if (filtered) setExpanded(expandableTaskKeys(tree));
    }, [filterKey]);
    const columns: ColumnsType<TaskNode> = [
        { title: 'Task', dataIndex: 'id', fixed: 'left', render: (id, t) => t.group
            ? <strong style={{whiteSpace:'nowrap'}}>{({Design:'策划',Art:'美术',Development:'程序',QA:'测试',PM:'项目管理'} as Record<string,string>)[t.role] ?? t.role}（{t.group.total}）</strong>
            : <span style={{whiteSpace:'nowrap'}}>
            {t.parent_id && t.role !== 'PM' && <Tooltip title={!canSelectDispatch ? '请先登录人工审批账户' : !['待调度','依赖阻塞'].includes(t.status) ? '该任务已派发或结束，不能在此修改' : '仅保存允许派发；依赖完成后才可启动，不自动勾选前置任务'}>
                <Checkbox aria-label={`允许派发 ${id}`} checked={t.dispatch_allowed === true}
                    disabled={!canSelectDispatch || !!savingTask || !t.task_uuid || !['待调度','依赖阻塞'].includes(t.status)}
                    onChange={e => setDispatch?.(t,e.target.checked)} />
            </Tooltip>}
            <Button type="link" style={{ whiteSpace: 'nowrap',padding:0,marginLeft:4 }} title={t.title} onClick={() => select(t)}>{id}</Button>
        </span> },
        { title: 'Deliverable', dataIndex: 'title', width: 240, render:(title,t)=>t.group ? `共 ${t.group.total} 项 · 完成 ${t.group.completed} · 阻塞 ${t.group.blocked}${filtered ? '（筛选结果）' : ''}` : title },
        { title: 'Role', dataIndex: 'role', filteredValue:filters.role, filters: ['Design','Art', 'Development', 'QA','PM'].map(value => ({ text: value, value })) },
        { title: 'Agent', dataIndex: 'agent', render: a => a ?? '—' },
        { title: 'Status', dataIndex: 'status', filteredValue:filters.status, filters: ['待调度','执行中', '依赖阻塞', '等待交付','已完成'].map(value => ({ text: value, value })), render: (s,t) => t.group ? null : <StateTag value={s} /> },
        { title: 'Dependency', dataIndex: 'dependencies', width: 118, align: 'left', render: (ids,t) => t.group ? null : <TaskLinks ids={ids} tasks={allTasks} select={select} /> },
        { title: 'Version', dataIndex: 'version', sorter: (a, b) => a.version.localeCompare(b.version) },
    ];
    const resizableColumns = columns.map((column,index)=>({...column,width:widths[index],ellipsis:index===1 || index===3,
        onHeaderCell:()=>({style:{width:widths[index]},resizeWidth:widths[index],minimumWidth:taskColumnMinimums[index],resizeLabel:String(column.title),
            onResizeWidth:(width:number)=>setWidths(old=>old.map((value,i)=>i===index ? width : value))})}));
    return <Table<TaskNode> size="small" rowKey="id" tableLayout="fixed" columns={resizableColumns} dataSource={tree}
        components={{header:{cell:ResizableHeader}}}
        expandable={{expandedRowKeys:expanded,onExpandedRowsChange:keys=>setExpanded([...keys]),indentSize:10}}
        onChange={(_,values)=>setFilters({role:values.role?.map(String) ?? [],status:values.status?.map(String) ?? []})}
        pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: widths.reduce((sum,width)=>sum+width,0) }} />;
}
