import { Card, Table, Tag, Button } from 'antd';
import type { ReactNode } from 'react';
import type { ColumnsType } from 'antd/es/table';
import type { Agent, Task } from './model';
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
export function TaskTable({ tasks, select }: { tasks: Task[]; select: (task: Task) => void })
{
    const columns: ColumnsType<Task> = [
        { title: 'Task', dataIndex: 'id', fixed: 'left', width: 100, render: (id, t) => <Button type="link" onClick={() => select(t)}>{id}</Button> },
        { title: 'Deliverable', dataIndex: 'title', width: 240 },
        { title: 'Role', dataIndex: 'role', filters: ['Art', 'Development', 'QA'].map(value => ({ text: value, value })), onFilter: (value, t) => t.role === value },
        { title: 'Agent', dataIndex: 'agent', render: a => a ?? '—' },
        { title: 'Status', dataIndex: 'status', filters: ['执行中', '依赖阻塞', '等待交付'].map(value => ({ text: value, value })), onFilter: (value, t) => t.status === value, render: s => <StateTag value={s} /> },
        { title: 'Dependency', dataIndex: 'dependencies', render: ids => ids.join('、') || '无' },
        { title: 'Version', dataIndex: 'version', sorter: (a, b) => a.version.localeCompare(b.version) },
    ];
    return <Table size="small" rowKey="id" columns={columns} dataSource={tasks} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 950 }} />;
}
