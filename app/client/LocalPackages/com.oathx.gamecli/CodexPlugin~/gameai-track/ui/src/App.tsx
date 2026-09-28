import { useEffect, useRef, useState } from 'react';
import { App as AntApp, Alert, Badge, Button, Checkbox, ConfigProvider, Descriptions, Drawer, Empty, Form, Input, Modal, Progress, Select, Space, Spin, Splitter, Table, Tabs, Tag, Typography, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { TrackBridge } from './bridge';
import { canApprove, type Agent, type Audit, type Identity, type Snapshot, type RequirementRow, type Task, type Workbench } from './model';
import { AgentTable, Section, StateTag, TaskTable } from './components';
const identities = [{ value: 'design', label: '策划 · 人工审批人' }, { value: 'admin', label: '项目管理员' }, { value: 'art', label: '美术 · 只读' }, { value: 'dev', label: '开发 · 只读' }, { value: 'qa', label: 'QA · 只读' }, { value: 'pm', label: 'PM · 只读' }];
const tabs = [['overview', '项目总览'], ['requirements', '需求审批'], ['tasks', '任务与依赖'], ['agents', 'Agent'], ['versions', '版本'], ['permissions', '权限'], ['audit', '操作记录']];
export function WorkbenchApp()
{
    const [data, setData] = useState<Workbench>();
    const [persistent, setPersistent] = useState(false);
    const [testData, setTestData] = useState(false);
    const [identity, setIdentity] = useState<Identity>('design');
    const [tab, setTab] = useState('overview');
    const [version, setVersion] = useState('v1.3');
    const [query, setQuery] = useState('');
    const [requirementQuery, setRequirementQuery] = useState('');
    const [review, setReview] = useState<RequirementRow>();
    const [documentPreview, setDocumentPreview] = useState<RequirementRow>();
    const [detail, setDetail] = useState<Task | Agent>();
    const [dialog, setDialog] = useState<'approve' | 'revise'>();
    const [audit, setAudit] = useState<Audit[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [displayError, setDisplayError] = useState('');
    const [busy, setBusy] = useState(false);
    const [switching, setSwitching] = useState(false);
    const [updated, setUpdated] = useState('');
    const [context, setContext] = useState({ embedded: false, ready: false, mode: 'inline', modes: [] as string[] });
    const bridge = useRef<TrackBridge | null>(null);
    const mounted = useRef(true);
    const [form] = Form.useForm<{ reason: string }>();
    const { message } = AntApp.useApp();
    function log(text: string) { setLogs(old => [...old.slice(-99), `${new Date().toLocaleTimeString()}  ${text}`]); }
    function receive(snapshot: Snapshot)
    {
        // Transport refreshes do not silently erase local demonstration decisions.
        setPersistent(snapshot.mode === 'postgres');
        setTestData(snapshot.is_test === true);
        if (snapshot.mode === 'postgres') setAudit(snapshot.workbench.audit ?? []);
        setData(old => snapshot.mode === 'demo' && old && old.requirement.revision === snapshot.workbench.requirement.revision ? { ...snapshot.workbench, requirement: old.requirement, agents: snapshot.workbench.agents.map(a => ({ ...a, read: old.agents.find(x => x.id === a.id)?.read ?? a.read, write: old.agents.find(x => x.id === a.id)?.write ?? a.write })) } : snapshot.workbench);
        setUpdated(new Date(snapshot.server_time).toLocaleTimeString());
        setError('');
        log((snapshot.mode === 'postgres' ? '数据库快照已更新 · ' : '模拟快照已更新 · ') + snapshot.request_id);
    }
    async function refresh()
    {
        if (!bridge.current || busy) return;
        setBusy(true);
        try { const snapshot = await bridge.current.refresh(); if (mounted.current) receive(snapshot); }
        catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '连接失败'); }
        finally { if (mounted.current) setBusy(false); }
    }
    useEffect(() =>
    {
        mounted.current = true;
        const client = new TrackBridge();
        bridge.current = client;
        const update = () => setContext({ embedded: client.embedded, ready: client.ready, mode: client.mode, modes: client.modes });
        update();
        client.onContext = update;
        client.onSnapshot = receive;
        client.onError = e => setError(e.message);
        void refresh();
        return () => { mounted.current = false; client.dispose(); bridge.current = null; };
    }, []);
    async function display()
    {
        setSwitching(true); setDisplayError('');
        try { await bridge.current?.display(context.mode === 'inline' ? 'fullscreen' : 'inline'); }
        catch (e) { setDisplayError(e instanceof Error ? e.message : '展示模式切换失败'); }
        finally { setSwitching(false); }
    }
    function record(event: string)
    {
        setAudit(old => [{ id: Date.now(), time: new Date().toLocaleTimeString(), actor: identities.find(x => x.value === identity)!.label, event }, ...old].slice(0, 200));
        log(event + '（仅本页模拟）');
    }
    async function confirm()
    {
        if (!approvalAllowed || !data) { setDialog(undefined); return; }
        let reason = '';
        if (dialog === 'revise') { try { reason = (await form.validateFields()).reason.trim(); } catch { return; } }
        const status = dialog === 'approve' ? '已批准' : '退回修改';
        setData({ ...data, requirement: { ...data.requirement, status } });
        record(`${status} ${data.requirement.version} / ${data.requirement.revision}${reason ? '：' + reason : ''}`);
        setReview(old => old ? { ...old, status } : old);
        setDocumentPreview(old => old ? { ...old, status } : old);
        setDialog(undefined); form.resetFields();
        void message.success(status + '（模拟），未创建任务或启动 Agent。');
    }
    function grant(agent: Agent, kind: 'read' | 'write', value: boolean)
    {
        if (persistent || !data || identity !== 'admin') return;
        setData({ ...data, agents: data.agents.map(a => a.id === agent.id ? { ...a, [kind]: value } : a) });
        record(`${value ? '授予' : '撤销'} ${agent.id} 的${kind === 'read' ? '项目读取' : '任务写入'}权限`);
    }
    function openVersion(v: string)
    {
        setVersion(v);
        setTab('requirements');
        if (data)
        {
            const saved = data.versions?.find(item => item.version === v);
            const row = data.requirements?.[0] ?? { ...data.requirement, id: 'DEMO-REQ-1', document_path: null, created_at: null };
            setReview(saved ? { ...row, ...saved.content, version: saved.version, status: saved.status, revision: saved.revision } : { ...row, version: v });
        }
    }
    const current = data && version === data.requirement.version;
    const approvalAllowed = !persistent && !!data && !!documentPreview && documentPreview.revision === data.requirement.revision && documentPreview.status === '待审批' && canApprove(identity, version, data);
    const selectedAgent = detail && 'station' in detail ? data?.agents.find(a => a.id === detail.id) : undefined;
    const selectedTask = detail && 'dependencies' in detail ? detail : undefined;
    function body()
    {
        if (!data) return busy ? <div className="placeholder"><Spin description="正在读取工作台…" /></div> : <Empty description="未取得快照，请检查服务后重试" />;
        const selectedVersion = data.versions?.find(v => v.version === version);
        const r = review ?? data.requirement;
        const content = review ?? selectedVersion?.content ?? r;
        if (tab === 'overview') return <Section title="执行中的 Agent" extra={<Button onClick={() => setTab('agents')}>全部 Agent</Button>}><AgentTable agents={data.agents.filter(a => a.status === '执行中')} select={setDetail} /></Section>;
        if (tab === 'requirements') return <Section title="需求审批" extra={<Input.Search aria-label="搜索需求" placeholder="需求编号 / 名称" value={requirementQuery} allowClear onChange={e => setRequirementQuery(e.target.value)} style={{ width: 200 }} />}>
            <Table<RequirementRow> size="small" rowKey="id" pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 860 }}
                dataSource={(data.requirements ?? [{ ...data.requirement, id: 'DEMO-REQ-1', document_path: null, created_at: null }]).filter(item => [item.id, item.title].join(' ').toLowerCase().includes(requirementQuery.toLowerCase()))}
                columns={[
                    { title: 'ID', dataIndex: 'id', width: 110, fixed: 'left' },
                    { title: 'Requirement', dataIndex: 'title', width: 190 },
                    { title: 'Version', dataIndex: 'version', width: 85 },
                    { title: 'HTML', dataIndex: 'document_path', width: 250, render: (path, item) => path && item.document_url ? <Typography.Link href={item.document_url} onClick={event => { event.preventDefault(); setVersion(item.version); setDocumentPreview(item); }} style={{ overflowWrap: 'anywhere' }}>{path}</Typography.Link> : <Typography.Text type="secondary">未关联 HTML 文档</Typography.Text> },
                    { title: 'Status', dataIndex: 'status', width: 110, filters: ['待审批', '已批准', '退回修改'].map(text => ({ text, value: text })), onFilter: (value, item) => item.status === value, render: status => <StateTag value={status} /> },

                ]} />

        </Section>;
        if (tab === 'tasks') return <Section title="任务与依赖" extra={<Input.Search aria-label="搜索任务" placeholder="任务 / Agent" value={query} allowClear onChange={e => setQuery(e.target.value)} style={{ width: 180 }} />}><Typography.Paragraph type="secondary">任务使用 v1.2；依赖就绪后才允许派工。</Typography.Paragraph><TaskTable tasks={data.tasks.filter(t => [t.id, t.title, t.agent ?? ''].join(' ').toLowerCase().includes(query.toLowerCase()))} select={setDetail} /></Section>;
        if (tab === 'agents') return <Section title="项目 Agent"><Typography.Paragraph type="secondary">同角色可有多个实例；点击查看工作站、容量和授权。</Typography.Paragraph><AgentTable agents={data.agents} select={setDetail} /></Section>;
        if (tab === 'versions') return <Section title="需求版本"><Table size="small" rowKey="version" pagination={false} scroll={{ x: 600 }} dataSource={data.versions?.map(({ version, status, change, reference }) => ({ version, status, change, reference })) ?? [{ version: r.version, status: r.status, change: '异常恢复与测试用例', reference: '尚未派工' }, { version: 'v1.2', status: '已批准', change: '基础规则与 UI 交付标准', reference: '4 项任务 · 2 项执行中' }]} columns={[{ title: 'Version', dataIndex: 'version' }, { title: 'State', dataIndex: 'status', render: s => <StateTag value={s} /> }, { title: 'Change', dataIndex: 'change' }, { title: 'References', dataIndex: 'reference' }, { title: 'Action', render: (_, v) => <Button type="link" onClick={() => openVersion(v.version)}>审阅</Button> }]} /><Typography.Paragraph className="note">需求版本 → PM 计划版本 → 执行编号 → 产物版本 → QA 验收版本。历史版本只读，恢复内容需新建修订并重新审批。</Typography.Paragraph></Section>;
        if (tab === 'permissions') return <>
            <Section title="人工身份权限"><Alert type="info" title="身份切换仅用于演示；正式身份来自服务端会话，管理员不会自动获得审批权限。" /><Table size="small" pagination={false} rowKey="role" dataSource={[{ role: '策划 · 人工', read: '允许', approve: '允许', manage: '禁止' }, { role: 'PM / Art / Development / QA', read: '允许', approve: '禁止', manage: '禁止' }, { role: '项目管理员', read: '允许', approve: '禁止', manage: '允许' }]} columns={[{ title: 'Role', dataIndex: 'role' }, { title: 'Read', dataIndex: 'read' }, { title: 'Approve', dataIndex: 'approve' }, { title: 'Manage', dataIndex: 'manage' }]} /></Section>
            <Section title="Agent 授权"><Typography.Paragraph type="secondary">{persistent ? '数据库授权只读；没有开放匿名权限修改接口。' : identity === 'admin' ? '可模拟调整读取与任务写入权限。' : '只读预览；请切换到模拟管理员体验配置。'} Agent 不得自行批准，写入仅限有效任务授权。</Typography.Paragraph><Table size="small" rowKey="id" pagination={false} scroll={{ x: 650 }} dataSource={data.agents} columns={[{ title: 'Agent', dataIndex: 'id' }, { title: 'Role', dataIndex: 'role' }, { title: 'Read', render: (_, a) => <Checkbox aria-label={a.id + ' 读取'} disabled={persistent || identity !== 'admin'} checked={a.read} onChange={e => grant(a, 'read', e.target.checked)} /> }, { title: 'Write assigned task', render: (_, a) => <Checkbox aria-label={a.id + ' 写入'} disabled={persistent || identity !== 'admin'} checked={a.write} onChange={e => grant(a, 'write', e.target.checked)} /> }, { title: 'Approve', render: () => '禁止 · 需人工' }]} /></Section>
        </>;
        return <Section title="操作记录"><Table size="small" rowKey="id" dataSource={audit} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 550 }} locale={{ emptyText: '尚无操作记录；模拟审批和权限调整将记录在这里。' }} columns={[{ title: 'Time', dataIndex: 'time' }, { title: 'Actor', dataIndex: 'actor' }, { title: 'Event', dataIndex: 'event' }]} /></Section>;
    }
    return <div className="workbench">
        <header className="app-header"><Space><Typography.Text strong>◈ GameAI / Track</Typography.Text><Tag color={persistent ? "green" : "gold"}>{persistent ? `PostgreSQL · ${testData ? "测试数据" : "项目数据"}` : "组件演示 · 模拟数据"}</Tag></Space><Space><Button loading={busy} onClick={() => void refresh()}>刷新</Button>{context.embedded && <Button loading={switching} disabled={!context.ready || !context.modes.includes(context.mode === 'inline' ? 'fullscreen' : 'inline')} onClick={() => void display()}>{context.mode === 'inline' ? '在侧栏打开' : '返回对话'}</Button>}</Space></header>
        <div className="context-row"><Typography.Text strong>{data?.project.name ?? 'GameAI'}</Typography.Text><div className="counters"><span>待审批 <b>{data?.requirement.status === '待审批' ? 1 : 0}</b></span><span>执行中 <b>{data?.agents.filter(a => a.status === '执行中').length ?? '—'}</b></span><span>阻塞 <b>{data?.tasks.filter(t => t.status === '依赖阻塞' || t.status === '等待交付').length ?? '—'}</b></span><span>空闲 <b>{data?.agents.filter(a => a.status === '空闲').length ?? '—'}</b></span></div><Select aria-label="模拟身份" disabled={persistent} value={identity} onChange={v => { setIdentity(v); setDialog(undefined); }} options={identities} style={{ width: 166 }} /></div>
        <div className="connection"><Badge status={error ? 'error' : updated ? 'success' : 'processing'} text={error ? '连接失败 / 数据可能过期' : updated ? (persistent ? '数据库快照 · ' : '模拟快照 · ') + updated : '连接中'} /><Typography.Text type="secondary">{context.embedded ? context.mode === 'fullscreen' ? '侧栏模式' : '内嵌模式' : '浏览器预览仅验证网页与 HTTP'}</Typography.Text></div>
        {error && <Alert type="error" showIcon title={error} />}{displayError && <Alert type="warning" closable title={displayError} />}
        <Tabs className="navigation" activeKey={tab} onChange={key => { setTab(key); setDocumentPreview(undefined); }} items={tabs.map(([key, label]) => ({ key, label }))} />
        <div className="panels"><Splitter orientation="vertical"><Splitter.Panel defaultSize="78%" min={160}><main className={tab === 'requirements' ? 'page-content page-content--requirements' : 'page-content'}>{body()}</main></Splitter.Panel><Splitter.Panel min={65} collapsible><div className="output"><div className="output-title">Output <Typography.Text type="secondary">{persistent ? "数据库持久化 · 运行日志仅当前页面" : "仅本页模拟 · 刷新浏览器清除操作"}</Typography.Text></div><pre aria-live="polite">{logs.length ? logs.join('\n') : '等待连接与操作…'}</pre></div></Splitter.Panel></Splitter>
            <Drawer title={documentPreview ? documentPreview.id + ' / ' + documentPreview.title + ' / ' + documentPreview.version : '需求原文'} open={!!documentPreview} onClose={() => setDocumentPreview(undefined)} placement="right" size="100%" getContainer={false} rootStyle={{ position: 'absolute' }} styles={{ body: { padding: 0, overflow: 'hidden' } }} destroyOnHidden footer={
                <div className="document-review-footer">
                    <div><Space><Typography.Text strong>{documentPreview?.version}</Typography.Text><StateTag value={documentPreview?.status ?? '待审批'} /></Space><Typography.Text type="secondary" className="document-review-hint">{persistent ? '正式登录与审批写入待接入，当前只读。' : approvalAllowed ? '请阅读全文后确认此版本；当前为模拟审批。' : '当前身份或版本不可审批。'}</Typography.Text></div>
                    <Space><Button danger disabled={!approvalAllowed} onClick={() => { form.resetFields(); setDialog('revise'); }}>拒绝</Button><Button type="primary" disabled={!approvalAllowed} onClick={() => setDialog('approve')}>同意</Button></Space>
                </div>
            }>
                {documentPreview?.document_url && <iframe className="requirement-original" title="需求原始 HTML" src={documentPreview.document_url} sandbox="" referrerPolicy="no-referrer" />}
            </Drawer>
        </div>
        <Drawer title={detail?.id} open={!!detail} onClose={() => setDetail(undefined)} size={420} getContainer={false} styles={{ wrapper: { maxWidth: '100%' } }}>
            {selectedTask && <><Typography.Title level={5}>{selectedTask.title}</Typography.Title><StateTag value={selectedTask.status} /><Descriptions column={1} items={[{ key: 'v', label: '需求版本', children: selectedTask.version }, { key: 'a', label: 'Agent', children: selectedTask.agent ?? '未分配' }, { key: 'd', label: '依赖', children: selectedTask.dependencies.join('、') || '无' }]} /><Progress percent={selectedTask.progress} /><Alert type="info" title="模拟执行记录，没有真实产物或验收证据。" /></>}
            {selectedAgent && <Descriptions column={1} items={[{ key: 'r', label: '角色', children: selectedAgent.role }, { key: 's', label: '状态', children: <StateTag value={selectedAgent.status} /> }, { key: 'w', label: '工作站', children: selectedAgent.station }, { key: 'c', label: '容量', children: `${selectedAgent.used} / ${selectedAgent.capacity}` }, { key: 't', label: '任务', children: selectedAgent.task ?? '—' }, { key: 'read', label: '项目读取', children: selectedAgent.read ? '允许' : '禁止' }, { key: 'write', label: '任务写入', children: selectedAgent.write ? '仅限授权任务' : '禁止' }, { key: 'p', label: '文档审批', children: '禁止，需人工批准' }]} />}
        </Drawer>
        <Modal title={dialog === 'approve' ? '同意此版本 · 模拟' : '拒绝此版本 · 模拟'} open={!!dialog} onCancel={() => setDialog(undefined)} onOk={() => void confirm()} okText="确认" cancelText="返回审阅" okButtonProps={{ disabled: !approvalAllowed }} getContainer={false}>
            <p>{data?.requirement.title} / {version}</p><Typography.Text code>{data?.requirement.revision}</Typography.Text><p>操作只影响本页模拟状态，不写数据库、不创建任务、不启动 Agent。</p>
            {dialog === 'revise' && <Form form={form} layout="vertical"><Form.Item label="拒绝原因" name="reason" rules={[{ required: true, whitespace: true, message: '请填写拒绝原因' }]}><Input.TextArea maxLength={500} showCount /></Form.Item></Form>}
        </Modal>
    </div>;
}
export default function App()
{
    return <ConfigProvider locale={zhCN} componentSize="small" theme={{ algorithm: [theme.darkAlgorithm, theme.compactAlgorithm], token: { colorPrimary: '#7de0bd', colorBgBase: '#10151c', borderRadius: 6, fontSize: 13 } }} getPopupContainer={trigger => trigger?.closest<HTMLElement>('#root') ?? document.getElementById('root')!}><AntApp><WorkbenchApp /></AntApp></ConfigProvider>;
}
