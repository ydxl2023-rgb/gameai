import { useEffect, useRef, useState } from 'react';
import { Alert, Form, Input, InputNumber, Modal, Select, Spin, Switch } from 'antd';

interface WorkerOption { id: string; name: string; capacity: number; enabled: boolean; last_heartbeat_at: string | null; }
interface SkillOption { skill_key: string; name: string; path: string; role_code: string | null; content_hash: string; }
interface AgentOptions { workers: WorkerOption[]; skills: SkillOption[]; capability: string; }
interface AgentFields { name: string; role: string; worker_id: string; primary_skill: string; extra_skills: string[]; capacity: number; enabled: boolean; }

export function AgentCreateDialog({ open, close, created }: { open: boolean; close: () => void; created: (id: string) => void })
{
    const [form] = Form.useForm<AgentFields>();
    const [options, setOptions] = useState<AgentOptions>();
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const requestId = useRef('');
    const role = Form.useWatch('role', form);
    const workerId = Form.useWatch('worker_id', form);
    const worker = options?.workers.find(w => w.id === workerId);
    useEffect(() =>
    {
        if (!open) return;
        const controller = new AbortController();
        requestId.current = crypto.randomUUID();
        setOptions(undefined);
        setError('');
        form.resetFields();
        void (async () =>
        {
            try
            {
                const response = await fetch('/api/track/agent-options', { cache: 'no-store', signal: controller.signal });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error ?? '无法读取节点和技能。');
                if (!controller.signal.aborted)
                {
                    setOptions(result);
                    form.setFieldsValue({ primary_skill: result.skills.find((s: SkillOption) => s.role_code === 'Design' && !s.skill_key.includes('/'))?.skill_key });
                }
            }
            catch (e)
            {
                if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取配置失败。');
            }
        })();
        return () => controller.abort();
    }, [open, form]);
    async function save()
    {
        if (!options || saving) return;
        let fields: AgentFields;
        try { fields = await form.validateFields(); }
        catch { return; }
        setSaving(true);
        setError('');
        try
        {
            const response = await fetch('/api/track/agents', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GameAI-Agent-Capability': options.capability },
                body: JSON.stringify({ ...fields, request_id: requestId.current }), signal: AbortSignal.timeout(15000)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? '保存失败，请重试。');
            created(result.id);
        }
        catch (e)
        {
            setError(e instanceof Error ? e.message : '保存结果未知，可使用当前表单重试，服务端会避免重复创建。');
        }
        finally { setSaving(false); }
    }
    return <Modal title="添加 Agent" open={open} onCancel={saving ? undefined : close} onOk={() => void save()} okText="保存 Agent" cancelText="取消" confirmLoading={saving} okButtonProps={{ disabled: !options }} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} getContainer={false} destroyOnHidden>
        <Alert type="info" showIcon title="本机配置管理：保存角色与技能，不会启动任务。技能选择不会授予审批或任务写入权限。" />
        {error && <Alert type="error" showIcon title={error} style={{ marginTop: 12 }} />}
        {!options && !error && <Spin style={{ margin: 20 }} />}
        <Form form={form} layout="vertical" disabled={!options || saving} initialValues={{ role: 'Design', capacity: 1, enabled: true, extra_skills: [] }} style={{ marginTop: 16 }}>
            <Form.Item name="name" label="Agent 名称" rules={[{ required: true, whitespace: true, message: '请输入名称' }]}><Input maxLength={80} placeholder="例如：活动策划 Agent" /></Form.Item>
            <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={['Design', 'PM', 'Art', 'Development', 'QA'].map(value => ({ value, label: value }))} onChange={value => form.setFieldsValue({ primary_skill: options?.skills.find(s => s.role_code === value && !s.skill_key.includes('/'))?.skill_key, extra_skills: [] })} /></Form.Item>
            <Form.Item name="worker_id" label="执行节点" rules={[{ required: true, message: '请选择节点' }]}><Select placeholder="选择已有 GameCLI 节点" options={options?.workers.map(w => ({ value: w.id, label: `${w.name} · 容量 ${w.capacity} · ${w.enabled && w.last_heartbeat_at && Date.now() - Date.parse(w.last_heartbeat_at) < 60000 ? '在线' : '离线'}` }))} onChange={() => form.setFieldValue('capacity', 1)} /></Form.Item>
            <Form.Item name="primary_skill" label="主技能" rules={[{ required: true, message: '请选择匹配角色的主技能' }]}><Select options={options?.skills.filter(s => s.role_code === role && !s.skill_key.includes('/')).map(s => ({ value: s.skill_key, label: s.name }))} /></Form.Item>
            <Form.Item name="extra_skills" label="专业／公共技能"><Select mode="multiple" allowClear placeholder="可多选" options={options?.skills.filter(s => !s.role_code || (s.role_code === role && s.skill_key.includes('/'))).map(s => ({ value: s.skill_key, label: s.name }))} /></Form.Item>
            <Form.Item name="capacity" label="并发容量" rules={[{ required: true }]}><InputNumber min={1} max={Math.min(worker?.capacity ?? 16, 16)} precision={0} /></Form.Item>
            <Form.Item name="enabled" label="允许后续调度" valuePropName="checked"><Switch /></Form.Item>
        </Form>
    </Modal>;
}
