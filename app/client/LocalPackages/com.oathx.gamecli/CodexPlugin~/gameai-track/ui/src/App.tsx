import { ResizableTable } from './ResizableTable';
import { canDispatchTask } from './task-tree';
import { useEffect, useRef, useState } from 'react';
import { App as AntApp, Alert, Badge, Button, Checkbox, ConfigProvider, Descriptions, Drawer, Empty, Form, Input, Modal, Progress, Select, Space, Spin, Splitter, Tabs, Tag, Typography, theme } from 'antd';
import { AgentSkillsDialog } from './AgentSkillsDialog';
import { WorkflowOutput } from './WorkflowOutput';
import { AgentHistory } from './AgentHistory';
import { AgentCreateDialog } from './AgentCreateDialog';
import { TaskDispatchDialog, type DispatchRow } from './TaskDispatchDialog';
import { PmSplitButton } from './PmSplitButton';
import zhCN from 'antd/locale/zh_CN';
import { TrackBridge } from './bridge';
import { canApprove, type Agent, type Audit, type Identity, type Snapshot, type RequirementRow, type Task, type Workbench } from './model';
import { agentWorkStatus, AgentStatusTag, AgentTable, Section, StateTag, TaskTable, TaskLinks } from './components';
const identities = [{ value: 'design', label: '策划 · 人工审批人' }, { value: 'admin', label: '项目管理员' }, { value: 'art', label: '美术 · 只读' }, { value: 'dev', label: '开发 · 只读' }, { value: 'qa', label: 'QA · 只读' }, { value: 'pm', label: 'PM · 只读' }];
const tabs = [['overview', '项目总览'], ['requirements', '需求审批'], ['tasks', '任务与依赖'], ['versions', '版本'], ['permissions', '权限'], ['audit', '操作记录']];
export function WorkbenchApp()
{
    const [data, setData] = useState<Workbench>();
    const [skillAgent,setSkillAgent] = useState<Agent>();
    const [addingAgent, setAddingAgent] = useState(false);
    const [reviewSession, setReviewSession] = useState<{ authenticated: boolean; name?: string; csrf?: string }>({ authenticated: false });
    const [loginOpen, setLoginOpen] = useState(false);
    const [savingAutomation,setSavingAutomation] = useState<string>();
    const [automaticApproval,setAutomaticApproval] = useState(false);
    const [savingReview, setSavingReview] = useState(false);
    const [startingPm, setStartingPm] = useState<string>();
    const [dispatchRows,setDispatchRows] = useState<DispatchRow[]>();
    const [dispatchInput,setDispatchInput] = useState<{task_id:string;revision:number}[]>([]);
    const [dispatchBusy,setDispatchBusy] = useState(false);
    const dispatchLock = useRef(false);
    const [savingTask,setSavingTask] = useState<string>();
    const [loginForm] = Form.useForm<{ username: string; password: string }>();
    const [persistent, setPersistent] = useState(false);
    const [testData, setTestData] = useState(false);
    const [identity, setIdentity] = useState<Identity>('design');
    const [tab, setTab] = useState('overview');
    const [version, setVersion] = useState('v1.3');
    const [query, setQuery] = useState('');
    const [requirementQuery, setRequirementQuery] = useState('');
    const [review, setReview] = useState<RequirementRow>();
    const [documentPreview, setDocumentPreview] = useState<RequirementRow>();
    const [documentHtml, setDocumentHtml] = useState<string>();
    const [documentError, setDocumentError] = useState('');
    const [reviewUrl, setReviewUrl] = useState('http://127.0.0.1:18090/track');
    const [detail, setDetail] = useState<Task | Agent>();
    const [historyRequirement,setHistoryRequirement] = useState<string>();
    useEffect(()=>setAutomaticApproval(false),[documentPreview?.version_id]);
    const [dialog, setDialog] = useState<'approve' | 'revise'>();
    const [audit, setAudit] = useState<Audit[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [displayError, setDisplayError] = useState('');
    const [busy, setBusy] = useState(false);
    const [switching, setSwitching] = useState(false);
    const [updated, setUpdated] = useState('');
    const [context, setContext] = useState({ embedded: false, ready: false, mode: 'inline', modes: [] as string[] });
    useEffect(() =>
    {
        setDocumentHtml(undefined); setDocumentError('');
        if (!context.embedded || !documentPreview?.version_id) return;
        let active = true;
        void bridge.current?.document(documentPreview.version_id).then(html => { if (active) setDocumentHtml(html); }).catch(e => { if (active) setDocumentError(e.message); });
        return () => { active = false; };
    }, [documentPreview?.version_id, context.embedded]);
    const bridge = useRef<TrackBridge | null>(null);
    const mounted = useRef(true);
    const refreshing = useRef(false);
    const [form] = Form.useForm<{ reason: string }>();
    const { message } = AntApp.useApp();
    function log(text: string) { setLogs(old => [...old.slice(-99), `${new Date().toLocaleTimeString()}  ${text}`]); }
    function receive(snapshot: Snapshot)
    {
        if (typeof (snapshot as Snapshot & {review_url?:string}).review_url === 'string') setReviewUrl((snapshot as Snapshot & {review_url:string}).review_url);
        // Transport refreshes do not silently erase local demonstration decisions.
        setPersistent(snapshot.mode === 'postgres');
        setTestData(snapshot.is_test === true);
        if (snapshot.mode === 'postgres') setAudit(snapshot.workbench.audit ?? []);
        setData(old => snapshot.mode === 'demo' && old && old.requirement.revision === snapshot.workbench.requirement.revision ? { ...snapshot.workbench, requirement: old.requirement, agents: snapshot.workbench.agents.map(a => ({ ...a, read: old.agents.find(x => x.id === a.id)?.read ?? a.read, write: old.agents.find(x => x.id === a.id)?.write ?? a.write })) } : snapshot.workbench);
        setUpdated(new Date(snapshot.server_time).toLocaleTimeString());
        setError('');
        if (snapshot.mode === 'demo') log('模拟快照已更新 · ' + snapshot.request_id);
    }
    async function refresh()
    {
        if (!bridge.current || refreshing.current) return;
        refreshing.current = true;
        setBusy(true);
        try { const snapshot = await bridge.current.refresh(); if (mounted.current) receive(snapshot); }
        catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '连接失败'); }
        finally { refreshing.current = false; if (mounted.current) setBusy(false); }
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
    useEffect(() =>
    {
        if (!persistent || context.embedded) return;
        let active = true;
        void fetch('/api/track/review-session', { signal: AbortSignal.timeout(10000) }).then(r => r.json()).then(value => { if (active) setReviewSession(value); }).catch(() => {});
        return () => { active = false; };
    }, [persistent, context.embedded]);
    useEffect(() =>
    {
        if (!persistent) return;
        // Keep observing external work even when the previous snapshot was idle.
        const timer = window.setInterval(() => void refresh(), 3000);
        return () => window.clearInterval(timer);
    }, [persistent]);

    async function setAutomatic(agent:Agent,enabled:boolean)
    {
        if(savingAutomation) return;
        setSavingAutomation(agent.id);
        try
        {
            await reviewRequest('review-agent-automation',{agent:agent.id,enabled,revision:agent.automation_revision ?? 0});
            await refresh();
            void message.success(enabled?'已开启自动执行，作用于后续批准的需求':'已关闭自动执行，已运行任务继续完成');
        }
        catch(e){void message.error(e instanceof Error?e.message:'设置失败');await refresh();}
        finally {setSavingAutomation(undefined);}
    }

    async function splitRequirement(row: RequirementRow)
    {
        if (startingPm) return;
        setStartingPm(row.id);
        try
        {
            const result = await reviewRequest('review-pm-split', {version_id:row.version_id,revision:row.revision,document_hash:row.document_hash});
            setData(old => old ? {...old,requirements:old.requirements?.map(r => r.version_id === row.version_id ? {...r,pm_job:{state:result.state,error:'',attempts:r.pm_job?.attempts ?? 1,task_count:r.pm_job?.task_count ?? 0}} : r)} : old);
            log(`${row.id}：${result.repeated ? '已有 PM 拆分记录' : '已启动固定 PM Agent'}，进度自动刷新。`);
            void message.success(result.repeated ? '已读取现有拆分状态' : 'PM 已开始拆分，完成后可在任务与依赖中查看');
            await refresh();
        }
        catch (e) { void message.error(e instanceof Error ? e.message : 'PM 启动失败'); }
        finally { setStartingPm(undefined); }
    }

    function pmButton(row: RequirementRow)
    {
        const currentRow = data?.requirements?.find(r => r.version_id === row.version_id) ?? row;
        const automation=currentRow.approval_workflow;
        if (automation && ['queued','pm'].includes(automation.state)) return <Tag color="processing" title="已授权此批准版本的 PM、开发与 QA 自动执行">自动流程：PM 处理中</Tag>;
        if (automation?.state==='failed') return <Typography.Text type="danger" title={automation.error}>自动流程已暂停</Typography.Text>;
        return <PmSplitButton row={currentRow} allowed={persistent && !context.embedded && reviewSession.authenticated} busy={startingPm === row.id} start={() => void splitRequirement(currentRow)} />;
    }
    async function setTaskDispatch(task:Task,allowed:boolean)
    {
        if (savingTask) return;
        setSavingTask(task.id);
        try
        {
            const result = await reviewRequest('review-task-selection',{task_id:task.task_uuid,allowed,revision:task.dispatch_revision ?? 0});
            setData(old => old ? {...old,tasks:old.tasks.map(t => t.id === task.id ? {...t,...result} : t)} : old);
            log(`${task.id}：${allowed ? '已保存允许派发，等待依赖及编排器检查' : '已撤回派发许可'}，未启动 Agent。`);
            await refresh();
        }
        catch (e)
        {
            void message.error(e instanceof Error ? e.message : '保存失败');
            await refresh();
        }
        finally { setSavingTask(undefined); }
    }
    async function retryTask(task:Task)
    {
        if (dispatchLock.current || task.status !== '失败' || !task.task_uuid) return;
        dispatchLock.current=true;
        setDispatchBusy(true);
        try
        {
            const result=await reviewRequest('review-task-dispatch',{tasks:[{task_id:task.task_uuid,revision:task.dispatch_revision ?? 0}],retry:true,auto_continue:false});
            if (result.started > 0)
            {
                log(`人工重试：${task.id} 已重新启动，保留原任务和执行历史。`);
                void message.success(`${task.id} 已重新启动`);
            }
            else
            {
                const reason=result.rows.map((row:DispatchRow)=>row.reason).join('；') || '任务当前不能重试';
                log(`重试未启动 ${task.id}：${reason}`);
                void message.warning(reason);
            }
            await refresh();
        }
        catch(error)
        {
            void message.error(error instanceof Error ? error.message : '重试失败，请刷新核实状态');
            await refresh();
        }
        finally { dispatchLock.current=false; setDispatchBusy(false); }
    }
    async function previewDispatch(tasks:Task[])
    {
        const candidates=tasks.filter(canDispatchTask);
        if (dispatchLock.current || !candidates.length) return;
        dispatchLock.current=true;
        setDispatchBusy(true);
        try
        {
            const input=candidates.map(t=>({task_id:t.task_uuid!,revision:t.dispatch_revision ?? 0}));
            const result=await reviewRequest('review-task-preview',{tasks:input,retry:true});
            setDispatchInput(input);
            setDispatchRows(result.rows);
        }
        catch(e) { void message.error(e instanceof Error ? e.message : '派发检查失败'); }
        finally { dispatchLock.current=false; setDispatchBusy(false); }
    }
    async function confirmDispatch(automatic:boolean)
    {
        if (dispatchLock.current || !dispatchRows?.some(r=>r.ready)) return;
        dispatchLock.current=true;
        setDispatchBusy(true);
        try
        {
            // Submit only the tasks shown as ready; changed capacity cannot silently add another task.
            const ready=new Set(dispatchRows.filter(r=>r.ready).map(r=>r.task_id));
            const result=await reviewRequest('review-task-dispatch',{tasks:dispatchInput.filter(t=>ready.has(t.task_id)),retry:true,auto_continue:automatic});
            log(`人工派发：已启动 ${result.started} 个任务。`);
            result.rows.filter((r:DispatchRow)=>!r.ready).forEach((r:DispatchRow)=>log(`${r.id}：${r.reason}`));
            void message.info(`已派发 ${result.started} 个任务，其余任务保留勾选`);
            setDispatchRows(undefined);
            await refresh();
        }
        catch(e) { void message.error(e instanceof Error ? e.message : '派发失败，请刷新核实执行状态'); await refresh(); }
        finally { dispatchLock.current=false; setDispatchBusy(false); }
    }
    async function reviewRequest(path: string, body: unknown)
    {
        const response = await fetch('/api/track/' + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GameAI-Review-CSRF': reviewSession.csrf ?? '' },
            body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
        });
        const result = await response.json();
        if (!response.ok)
        {
            if (response.status === 401) setReviewSession({ authenticated: false });
            throw new Error(result.error ?? '操作失败');
        }
        return result;
    }
    async function login()
    {
        let values;
        try { values = await loginForm.validateFields(); } catch { return; }
        setSavingReview(true);
        try
        {
            setReviewSession(await reviewRequest('review-login', values));
            setLoginOpen(false); loginForm.resetFields();
            void message.success('人工审批账户已登录');
        }
        catch (e) { void message.error(e instanceof Error ? e.message : '登录失败'); }
        finally { setSavingReview(false); }
    }
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
        if (persistent && documentPreview)
        {
            setSavingReview(true);
            try
            {
                await reviewRequest('review-decisions', { version_id: documentPreview.version_id, revision: documentPreview.revision,
                    document_hash: documentPreview.document_hash, decision: dialog === 'approve' ? 'approved' : 'rejected', reason, ...(dialog==='approve' && automaticApproval ? {auto_start:true} : {}) });
                setDocumentPreview({ ...documentPreview, status });
                setDialog(undefined); form.resetFields();
                log(status + ' ' + documentPreview.id + ' / ' + documentPreview.version + '，已入库，未自动派工。');
                void message.success(status + '，已保存审批记录');
                await refresh();
            }
            catch (e) { void message.error(e instanceof Error ? e.message : '审批失败'); }
            finally { setSavingReview(false); }
            return;
        }

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
    const approvalAllowed = !savingReview && !!data && !!documentPreview && documentPreview.status === '待审批' && (persistent ? !context.embedded && reviewSession.authenticated && !!documentPreview.version_id && !!documentPreview.document_hash && data.requirements?.some(r => r.id === documentPreview.id && r.revision === documentPreview.revision && r.status === '待审批') === true : documentPreview.revision === data.requirement.revision && canApprove(identity, version, data));
    const selectedAgent = detail && 'station' in detail ? data?.agents.find(a => a.id === detail.id) : undefined;
    const selectedTask = detail && 'dependencies' in detail ? data?.tasks.find(t=>t.id===detail.id) : undefined;
    function body()
    {
        if (!data) return busy ? <div className="placeholder"><Spin description="正在读取工作台…" /></div> : <Empty description="未取得快照，请检查服务后重试" />;
        const selectedVersion = data.versions?.find(v => v.version === version);
        const r = review ?? data.requirement;
        const content = review ?? selectedVersion?.content ?? r;
        if (tab === 'overview') return <Section title="Agent" extra={<Button type="primary" size="small" aria-label="添加 Agent" title="添加 Agent" icon={<span aria-hidden="true" style={{fontSize:18,lineHeight:1}}>+</span>} disabled={!persistent || context.embedded} onClick={() => setAddingAgent(true)} />}><AgentTable agents={data.agents.filter(a => a.fixed)} select={agent=>{setHistoryRequirement(undefined);setDetail(agent);}} addSkills={persistent && !context.embedded ? setSkillAgent : undefined} /></Section>;
        if (tab === 'requirements') return <Section title="需求审批" extra={<Input.Search aria-label="搜索需求" placeholder="需求编号 / 名称" value={requirementQuery} allowClear onChange={e => setRequirementQuery(e.target.value)} style={{ width: 200 }} />}>
            <ResizableTable<RequirementRow> storageKey="gameai.track.requirements-widths.v1" size="small" rowKey="id" tableLayout="fixed" pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 600 }}
                dataSource={(data.requirements ?? [{ ...data.requirement, id: 'DEMO-REQ-1', document_path: null, created_at: null }]).filter(item => [item.id, item.title].join(' ').toLowerCase().includes(requirementQuery.toLowerCase()))}
                columns={[
                    { title: 'ID', dataIndex: 'id', width: 88, fixed: 'left', ellipsis: true },
                    { title: 'Requirement', dataIndex: 'title', ellipsis: true },
                    { title: 'Version', dataIndex: 'version', width: 68, ellipsis: true },
                    { title: 'HTML', dataIndex: 'document_path', width: 190, ellipsis: true, render: (path, item) => path && item.document_url ? <Typography.Link href={item.document_url} onClick={event => { event.preventDefault(); setVersion(item.version); setDocumentPreview(item); }} title={path} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(path).split(/[\\/]/).pop()}</Typography.Link> : <Typography.Text type="secondary">未关联 HTML 文档</Typography.Text> },
                    { title: 'Status', dataIndex: 'status', width: 92, filters: ['待审批', '已批准', '退回修改'].map(text => ({ text, value: text })), onFilter: (value, item) => item.status === value, render: status => <StateTag value={status} /> },
                    { title: 'Action', width: 142, render: (_, item) => pmButton(item) },
                ]} />

        </Section>;
        if (tab === 'tasks') return <Section title="任务与依赖" extra={<Space wrap><Button type="primary" disabled={!persistent || context.embedded || !reviewSession.authenticated || !!savingTask || dispatchBusy || !data.tasks.some(canDispatchTask)} loading={dispatchBusy} onClick={()=>void previewDispatch(data.tasks.filter(canDispatchTask))}>派发（{data.tasks.filter(canDispatchTask).length}）</Button><Input.Search aria-label="搜索任务" placeholder="任务 / Agent" value={query} allowClear onChange={e => setQuery(e.target.value)} style={{ width: 180 }} /></Space>}><Typography.Paragraph type="secondary">按主任务 → 角色分类 → 具体任务展开。勾选仅保存“允许派发”，不会立即启动；请点击派发按钮，经依赖、版本和容量检查后启动。</Typography.Paragraph>{data.flows?.map(flow=><Typography.Paragraph key={flow.requirement_key} type="secondary" ellipsis={{rows:1,tooltip:flow.reason}}>{flow.requirement_key} 自动推进：{flow.state==="active"?"运行中":flow.state==="paused"?"已暂停":"已结束"} {flow.reason}</Typography.Paragraph>)}<TaskTable openAgent={task=>{const agent=data.agents.find(a=>a.id===task.executor_agent); if(agent){setHistoryRequirement(task.requirement_key);setDetail(agent);} else {void message.warning('执行 Agent 已不可用');}}} retryTask={task=>void retryTask(task)} retryBusy={dispatchBusy} canSelectDispatch={persistent && !context.embedded && reviewSession.authenticated} savingTask={savingTask} setDispatch={(task,allowed) => void setTaskDispatch(task,allowed)} allTasks={data.tasks} tasks={data.tasks.filter(t => [t.id, t.title, t.agent ?? ''].join(' ').toLowerCase().includes(query.toLowerCase()))} select={setDetail} /></Section>;
        if (tab === 'versions') return <Section title="需求版本"><ResizableTable storageKey="gameai.track.versions-widths.v1" size="small" rowKey="version" pagination={false} scroll={{ x: 600 }} dataSource={data.versions?.map(({ version, status, change, reference }) => ({ version, status, change, reference })) ?? [{ version: r.version, status: r.status, change: '异常恢复与测试用例', reference: '尚未派工' }, { version: 'v1.2', status: '已批准', change: '基础规则与 UI 交付标准', reference: '4 项任务 · 2 项执行中' }]} columns={[{ title: 'Version', dataIndex: 'version' }, { title: 'State', dataIndex: 'status', render: s => <StateTag value={s} /> }, { title: 'Change', dataIndex: 'change' }, { title: 'References', dataIndex: 'reference' }, { title: 'Action', render: (_, v) => <Button type="link" onClick={() => openVersion(v.version)}>审阅</Button> }]} /><Typography.Paragraph className="note">需求版本 → PM 计划版本 → 执行编号 → 产物版本 → QA 验收版本。历史版本只读，恢复内容需新建修订并重新审批。</Typography.Paragraph></Section>;
        if (tab === 'permissions') return <>
            <Section title="Agent 授权"><Typography.Paragraph type="secondary">{persistent ? '读写授权只读；登录人工审批账户后可设置自动执行。PM 自动拆分并建单，其余角色依赖满足后执行；新授权适用于之后批准的需求。' : identity === 'admin' ? '可模拟调整读取与任务写入权限。' : '只读预览；请切换到模拟管理员体验配置。'} Agent 不得自行批准，写入仅限有效任务授权。</Typography.Paragraph><ResizableTable storageKey="gameai.track.agent-permissions-widths.v1" size="small" rowKey="id" pagination={false} scroll={{ x: 650 }} dataSource={data.agents} columns={[{ title: 'Agent', dataIndex: 'id' }, { title: 'Role', dataIndex: 'role' }, { title: 'Read', render: (_, a) => <Checkbox aria-label={a.id + ' 读取'} disabled={persistent || identity !== 'admin'} checked={a.read} onChange={e => grant(a, 'read', e.target.checked)} /> }, { title: 'Auto', key:'auto_execute', width:85, render: (_,a) => <Checkbox aria-label={a.id+' 自动执行'} checked={a.auto_execute===true} disabled={!persistent || context.embedded || !reviewSession.authenticated || !!savingAutomation || !a.fixed || !['PM','Art','Development','QA'].includes(a.role)} onChange={e=>void setAutomatic(a,e.target.checked)} /> }, { title: 'Write assigned task', render: (_, a) => <Checkbox aria-label={a.id + ' 写入'} disabled={persistent || identity !== 'admin'} checked={a.write} onChange={e => grant(a, 'write', e.target.checked)} /> }, { title: 'Approve', render: () => '禁止 · 需人工' }]} /></Section>
        </>;
        return <Section title="操作记录"><ResizableTable storageKey="gameai.track.audit-widths.v1" size="small" rowKey="id" dataSource={audit} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 550 }} locale={{ emptyText: '尚无操作记录；模拟审批和权限调整将记录在这里。' }} columns={[{ title: 'Time', dataIndex: 'time' }, { title: 'Actor', dataIndex: 'actor' }, { title: 'Event', dataIndex: 'event' }]} /></Section>;
    }
    return <div className="workbench">
        <header className="app-header"><Space><Typography.Text strong>◈ GameAI / Track</Typography.Text><Tag color={persistent ? "green" : "gold"}>{persistent ? `PostgreSQL · ${testData ? "测试数据" : "项目数据"}` : "组件演示 · 模拟数据"}</Tag></Space><Space>{persistent && <Button onClick={() => { if (context.embedded) { void bridge.current?.openReview(reviewUrl).catch(e => void message.error(e.message)); } else if (reviewSession.authenticated) { void reviewRequest('review-logout', {}).then(() => setReviewSession({ authenticated: false })).catch(e => void message.error(e.message)); } else setLoginOpen(true); }}>{!context.embedded && reviewSession.authenticated ? reviewSession.name + ' · 退出' : '审批人登录'}</Button>}<Button loading={busy} onClick={() => void refresh()}>刷新</Button>{context.embedded && <Button loading={switching} disabled={!context.ready || !context.modes.includes(context.mode === 'inline' ? 'fullscreen' : 'inline')} onClick={() => void display()}>{context.mode === 'inline' ? '在侧栏打开' : '返回对话'}</Button>}</Space></header>
        <div className="context-row"><Typography.Text strong>{data?.project.name ?? 'GameAI'}</Typography.Text><div className="counters"><span>待审批 <b>{data?.requirements?.filter(r => r.status === '待审批').length ?? (data?.requirement.status === '待审批' ? 1 : 0)}</b></span><span>工作 <b>{data?.agents.filter(a => agentWorkStatus(a) === '工作').length ?? '—'}</b></span><span>阻塞 <b>{data?.tasks.filter(t => t.status === '依赖阻塞' || t.status === '等待交付').length ?? '—'}</b></span><span>空闲 <b>{data?.agents.filter(a => a.enabled !== false && agentWorkStatus(a) === '空闲').length ?? '—'}</b></span></div><Typography.Text>{persistent ? reviewSession.authenticated ? reviewSession.name : "人工审批：未登录" : ""}</Typography.Text>{!persistent && <Select aria-label="模拟身份" value={identity} onChange={v => { setIdentity(v); setDialog(undefined); }} options={identities} style={{ width: 166 }} />}</div>
        <div className="connection"><Badge status={error ? 'error' : updated ? 'success' : 'processing'} text={error ? '连接失败 / 数据可能过期' : updated ? (persistent ? '数据库快照 · ' : '模拟快照 · ') + updated : '连接中'} /><Typography.Text type="secondary">{context.embedded ? context.mode === 'fullscreen' ? '侧栏模式' : '内嵌模式' : '浏览器预览仅验证网页与 HTTP'}</Typography.Text></div>
        {error && <Alert type="error" showIcon title={error} />}{displayError && <Alert type="warning" closable title={displayError} />}
        <Tabs className="navigation" activeKey={tab} onChange={key => { setTab(key); setDocumentPreview(undefined); }} items={tabs.map(([key, label]) => ({ key, label }))} />
        <div className="panels"><Splitter orientation="vertical"><Splitter.Panel defaultSize="78%" min={160}><main className={['overview', 'requirements', 'tasks', 'versions', 'permissions', 'audit'].includes(tab) ? 'page-content page-content--list' : 'page-content'}>{body()}</main></Splitter.Panel><Splitter.Panel min={65} collapsible><WorkflowOutput events={data?.activity ?? []} persistent={persistent} logs={logs} error={error} /></Splitter.Panel></Splitter>
            <Drawer title={documentPreview ? documentPreview.id + ' / ' + documentPreview.title + ' / ' + documentPreview.version : '需求原文'} open={!!documentPreview} onClose={() => setDocumentPreview(undefined)} placement="right" size="100%" getContainer={false} rootStyle={{ position: 'absolute' }} styles={{ body: { padding: 0, overflow: 'hidden' } }} destroyOnHidden footer={
                <div className="document-review-footer">
                    <div><Space><Typography.Text strong>{documentPreview?.version}</Typography.Text><StateTag value={documentPreview?.status ?? '待审批'} /></Space><Typography.Text type="secondary" className="document-review-hint">{persistent ? reviewSession.authenticated ? '审批绑定当前版本与原始 HTML；确认后写入数据库。' : context.embedded ? '内嵌面板只读；点击审批人登录，在本机页面阅读并完成审批。' : '请先通过顶部按钮登录人工审批账户。' : approvalAllowed ? '请阅读全文后确认此版本；当前为模拟审批。' : '当前身份或版本不可审批。'}</Typography.Text></div>
                    <Space>{documentPreview && pmButton(documentPreview)}<Button danger disabled={!approvalAllowed} onClick={() => { form.resetFields(); setDialog('revise'); }}>拒绝</Button><Button type="primary" disabled={!approvalAllowed} onClick={() => setDialog('approve')}>同意</Button></Space>
                </div>
            }>
                {context.embedded && !documentHtml && !documentError && <Spin description="正在读取原始 HTML…" />}
                {documentError && <Alert type="error" showIcon title={documentError} />}
                {context.embedded && documentHtml && <iframe className="requirement-original" title="需求原始 HTML" srcDoc={'<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;">' + documentHtml} sandbox="" referrerPolicy="no-referrer" />}
                {!context.embedded && documentPreview?.document_url && <iframe className="requirement-original" title="需求原始 HTML" src={documentPreview.document_url} sandbox="" referrerPolicy="no-referrer" />}
            </Drawer>
        </div>
        <Modal title="人工审批登录" open={loginOpen} confirmLoading={savingReview} onCancel={() => { if (!savingReview) setLoginOpen(false); }} onOk={() => void login()} okText="登录" cancelText="取消" getContainer={false}>
            <Form form={loginForm} layout="vertical"><Form.Item name="username" label="账户" rules={[{ required: true }]}><Input autoComplete="username" /></Form.Item><Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item></Form>
        </Modal>
        <AgentSkillsDialog agent={skillAgent} close={()=>setSkillAgent(undefined)} saved={()=>{setSkillAgent(undefined);void refresh();}} />
        <AgentCreateDialog open={addingAgent} close={() => setAddingAgent(false)} created={id => { setAddingAgent(false); setTab('overview'); log('已添加 Agent：' + id + '，等待节点上线及派工。'); void message.success('Agent 配置已保存'); void refresh(); }} />
        <TaskDispatchDialog rows={dispatchRows} busy={dispatchBusy} close={()=>{if (!dispatchBusy) setDispatchRows(undefined);}} confirm={automatic=>void confirmDispatch(automatic)} />
        <Drawer title={detail?.id} open={!!detail} onClose={() => setDetail(undefined)} size={selectedAgent ? 720 : 420} getContainer={false} styles={{ wrapper: { maxWidth: '100%' } }}>
            {selectedTask && <><Typography.Title level={5}>{selectedTask.title}</Typography.Title><Button type="primary" disabled={!persistent || context.embedded || !reviewSession.authenticated || !canDispatchTask(selectedTask) || dispatchBusy} onClick={()=>void previewDispatch([selectedTask])}>派发此任务</Button><StateTag value={selectedTask.status} /><Descriptions column={1} items={[{ key: 'v', label: '需求版本', children: selectedTask.version }, { key: 'a', label: 'Agent', children: selectedTask.agent ?? '未分配' }, { key: 'd', label: '依赖', children: <TaskLinks ids={selectedTask.dependencies} tasks={data?.tasks ?? []} select={setDetail} /> }]} />{selectedTask.repair && <Descriptions column={1} items={[{key:'source',label:'原开发 / QA 任务',children:<TaskLinks ids={[selectedTask.repair.source_task,selectedTask.repair.qa_task]} tasks={data?.tasks ?? []} select={setDetail} />},{key:'bound',label:'原开发 Agent',children:selectedTask.bound_agent},{key:'round',label:'返修轮次',children:selectedTask.repair.rounds+' / 3'},{key:'defect',label:'缺陷状态',children:({open:'等待返修',retest:'等待原 QA 复测',closed:'复测通过',exhausted:'三轮失败，需人工处理'} as Record<string,string>)[selectedTask.repair.state]},{key:'latest',label:'本轮问题',children:selectedTask.repair.details.actual}]} />}<Progress percent={selectedTask.progress} />{selectedTask.last_result && <Typography.Paragraph style={{whiteSpace:"pre-wrap"}}>{selectedTask.last_result}</Typography.Paragraph>}<Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{selectedTask.description}</Typography.Paragraph><Typography.Paragraph type="secondary">来源：{selectedTask.source_refs?.join('、') || '未记录'}</Typography.Paragraph><Descriptions column={1} items={selectedTask.criteria?.map(c => ({key:c.kind,label:({preconditions:'前置条件',steps:'操作与处理',success:'成功结果',failure:'失败提示',recovery:'异常恢复',tests:'测试用例'} as Record<string,string>)[c.kind] ?? c.kind,children:<span style={{whiteSpace:'pre-wrap'}}>{c.text}</span>}))} /><Alert type="info" title={persistent ? '启用自动推进后，交付和检查证据通过才放行后续已勾选任务；失败会暂停链路，QA 保留最终人工验收。' : '模拟执行记录，没有真实产物或验收证据。'} /></>}
            {selectedAgent && <Descriptions column={1} items={[{ key: 'name', label: '名称', children: selectedAgent.name ?? selectedAgent.id }, { key: 'skills', label: '技能', children: selectedAgent.skills?.map(s => s.key + (s.primary ? '（主技能）' : '')).join('、') || '未配置' }, { key: 'enabled', label: '允许调度', children: selectedAgent.enabled ? '是' : '否' }, { key: 'r', label: '角色', children: selectedAgent.role }, { key: 's', label: '状态', children: <AgentStatusTag agent={selectedAgent} /> }, { key: 'w', label: '工作站', children: selectedAgent.station }, { key: 'c', label: '容量', children: `${selectedAgent.used} / ${selectedAgent.capacity}` }, { key: 't', label: '任务', children: selectedAgent.task ?? '—' }, { key: 'read', label: '项目读取', children: selectedAgent.read ? '允许' : '禁止' }, { key: 'write', label: '任务写入', children: selectedAgent.write ? '仅限授权任务' : '禁止' }, { key: 'p', label: '文档审批', children: '禁止，需人工批准' }]} />}
            {selectedAgent && <AgentHistory key={selectedAgent.id+(historyRequirement ?? '')} agent={selectedAgent.id} requirementKey={historyRequirement} bridge={bridge.current} />}
        </Drawer>
        <Modal title={(dialog === 'approve' ? '同意此版本' : '拒绝此版本') + (persistent ? '' : ' · 模拟')} confirmLoading={savingReview} open={!!dialog} onCancel={() => { if (!savingReview) setDialog(undefined); }} onOk={() => void confirm()} okText="确认" cancelText="返回审阅" okButtonProps={{ disabled: !approvalAllowed }} getContainer={false}>
            <p>{documentPreview?.title} / {documentPreview?.version}</p><Typography.Text code>{documentPreview?.revision}</Typography.Text><p>{persistent ? "将保存当前人工账户的审批决定、版本及文档校验值。仅勾选下方选项时，批准后自动启动后续执行。" : "操作只影响本页模拟状态，不写数据库、不创建任务、不启动 Agent。"}</p>
            {persistent && dialog==='approve' && <Typography.Paragraph type="secondary">默认按 Agent 授权中的自动设置执行：{data?.agents.filter(a=>a.fixed && a.auto_execute).map(a=>a.role).join('、') || '全部手动'}。勾选下方选项可单独授权本版本全流程。</Typography.Paragraph>}
            {persistent && dialog==='approve' && <Checkbox checked={automaticApproval} disabled={savingReview} onChange={e=>setAutomaticApproval(e.target.checked)}>批准后自动启动 PM 拆分，并允许本版本全部子任务按依赖执行（包含 QA 与缺陷返修）</Checkbox>}
            {dialog === 'revise' && <Form form={form} layout="vertical"><Form.Item label="拒绝原因" name="reason" rules={[{ required: true, whitespace: true, message: '请填写拒绝原因' }]}><Input.TextArea maxLength={500} showCount /></Form.Item></Form>}
        </Modal>
    </div>;
}
export default function App()
{
    return <ConfigProvider locale={zhCN} componentSize="small" theme={{ algorithm: [theme.darkAlgorithm, theme.compactAlgorithm], token: { colorPrimary: '#7de0bd', colorBgBase: '#10151c', borderRadius: 6, fontSize: 14 } }} getPopupContainer={trigger => trigger?.closest<HTMLElement>('#root') ?? document.getElementById('root')!}><AntApp><WorkbenchApp /></AntApp></ConfigProvider>;
}
