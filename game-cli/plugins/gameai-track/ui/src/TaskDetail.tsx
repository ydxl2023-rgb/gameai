import { useEffect, useState } from 'react';
import { Alert, Button, Progress, Spin, Typography, Input, Select, Tooltip } from 'antd';
import type { Task } from './model';
import type { TrackBridge } from './bridge';
import { StateTag, TaskLinks } from './components';
import { AutoHeightDocument } from './AutoHeightDocument';
import { taskDescription, taskWireframes } from './task-document';

const taskLabels:Record<string,string> = {来源:'需求来源',范围:'任务范围',依赖:'任务依赖',前置依赖:'任务依赖',条件:'启动条件',交付物:'交付内容',操作与处理:'操作处理'};
const fieldByLabel:Record<string,string> = {范围:'scope',任务范围:'scope',条件:'start',启动条件:'start',交付物:'deliverable',交付内容:'deliverable',完成条件:'completion',完成门禁:'completion'};
const criteriaLabels:Record<string,string> = {preconditions:'前置条件',steps:'操作处理',success:'成功结果',failure:'失败提示',recovery:'异常恢复',tests:'测试用例'};

export function TaskDetail({task, tasks, bridge, select, dispatch, dispatchDisabled, editable=false, editReason, requestLogin, save, onEditing}: {
    task:Task; tasks:Task[]; bridge:TrackBridge|null; select:(task:Task)=>void; dispatch:()=>void; dispatchDisabled:boolean; editable?:boolean; editReason?:string; requestLogin?:()=>void; save?:(field:string,value:string|string[],reason:string,revision:number)=>Promise<void>; onEditing?:(editing:boolean)=>void;
})
{
    const [wire, setWire] = useState<ReturnType<typeof taskWireframes>>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [editing,setEditing] = useState<string>();
    const [editingRevision,setEditingRevision] = useState(0);
    const [value,setValue] = useState<string|string[]>('');
    const [reason,setReason] = useState('');
    const [saving,setSaving] = useState(false);
    const [editError,setEditError] = useState('');
    function beginEdit(field:string,current:string|string[])
    {
        if (editing && !window.confirm('当前内容尚未保存，是否放弃修改？')) return;
        setEditingRevision(task.content_revision??0);setEditing(field);setValue(current);setReason('');setEditError('');onEditing?.(true);
    }
    function cancelEdit()
    {
        if(saving)return;
        setEditing(undefined);setEditError('');onEditing?.(false);
    }
    async function submitEdit()
    {
        if(!save || !editing || saving)return;
        setSaving(true);setEditError('');
        try { await save(editing,value,reason,editingRevision);setEditing(undefined);onEditing?.(false); }
        catch(e) {setEditError(e instanceof Error ? e.message : '保存失败，请重试。');}
        finally {setSaving(false);}
    }
    function pencil(field:string,current:string|string[])
    {
        return <Tooltip title={editable ? "编辑此项" : editReason ?? "当前任务不可编辑"}><span className="task-item-edit-wrap"><Button className="task-item-edit" type="text" size="small" aria-label={'编辑'+(criteriaLabels[field]??({scope:'任务范围',start:'启动条件',deliverable:'交付内容',completion:'完成条件',title:'交付名称',dependencies:'任务依赖'} as Record<string,string>)[field])} disabled={!editable || saving} onClick={()=>beginEdit(field,current)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/></svg></Button></span></Tooltip>;
    }
    function editor(field:string)
    {
        return editing===field && <div className="task-item-editor">
            {field==='dependencies' ? <Select mode="multiple" aria-label="编辑任务依赖" style={{width:'100%'}} value={value as string[]} disabled={saving} onChange={setValue} options={tasks.filter(t=>t.parent_id===task.parent_id && t.id!==task.id && t.task_uuid).map(t=>({value:t.task_uuid!,label:t.id+' · '+t.title}))}/> : <Input.TextArea aria-label="编辑内容" autoSize={{minRows:2,maxRows:18}} maxLength={field==='title'?200:6000} value={value as string} disabled={saving} onChange={e=>setValue(e.target.value)}/>}
            <Input aria-label="修改原因" placeholder="修改原因（可选）" maxLength={500} value={reason} disabled={saving} onChange={e=>setReason(e.target.value)}/>
            {editError && <Alert type="error" title={editError}/>}
            <div><Button type="primary" size="small" loading={saving} disabled={typeof value==='string' && !value.trim()} onClick={()=>void submitEdit()}>保存</Button> <Button size="small" disabled={saving} onClick={cancelEdit}>取消</Button></div>
        </div>;
    }
    function row(label:string,text:string,field?:string)
    {
        return <div className="task-text-row" key={field??label}><dt>{label}：</dt><dd><div className="task-item-value">{text}{field && pencil(field,text)}</div>{field && editor(field)}</dd></div>;
    }
    function textRows(lines:string[])
    {
        return <dl className="task-text-rows">{lines.map((line,i)=>{
            const match=/^([^：:]+)[:：]\s*([\s\S]*)$/.exec(line.trim());
            return match ? row(taskLabels[match[1]]??match[1],match[2],fieldByLabel[match[1]]) : <div className="task-text-plain" key={i}>{line}</div>;
        })}</dl>;
    }
    const references = JSON.stringify(task.source_refs ?? []);
    useEffect(() => {
        let active = true;
        setWire(undefined);
        setError('');
        setLoading(false);
        if (!task.requirement_version_id || !bridge) return;
        setLoading(true);
        void bridge.document(task.requirement_version_id, task.document_url).then(html => {
            if (active) setWire(taskWireframes(html, JSON.parse(references)));
        }).catch(e => {if (active) setError(e.message);}).finally(()=>{if(active)setLoading(false);});
        return () => {active=false;};
    }, [task.id, task.requirement_version_id, task.document_url, references, bridge]);
    const description = taskDescription(task.description);
    return <div className="task-detail">
        {!editable && editReason && <Alert className="task-edit-notice" type="info" title={editReason} action={requestLogin && <Button size="small" onClick={requestLogin}>登录后编辑</Button>}/>}
        <div className="task-detail-title"><Typography.Title level={5}>{task.title}</Typography.Title>{pencil("title",task.title)}</div>{editor("title")}
        <div className="task-detail-meta">
            <Button type="primary" size="small" disabled={dispatchDisabled} onClick={dispatch}>派发此任务</Button>
            <StateTag value={task.status}/>
            <span>版本：<strong>{task.version}</strong></span>
            <span>Agent：<strong>{task.agent ?? '未分配'}</strong></span>
            <span className="task-detail-deps">依赖：<TaskLinks ids={task.dependencies} tasks={tasks} select={select}/>{pencil("dependencies",task.dependencies.map(id=>tasks.find(t=>t.id===id)?.task_uuid).filter((id):id is string=>!!id))}</span>
        </div>
        {editor("dependencies")}
        <Progress percent={task.progress} size="small"/>
        {task.repair && <Alert type="warning" title="返修任务" description={<><TaskLinks ids={[task.repair.source_task,task.repair.qa_task]} tasks={tasks} select={select}/><div>绑定 Agent：{task.bound_agent ?? '未记录'} · 第 {task.repair.rounds} 轮</div>{task.repair.details.actual}</>}/>}
        <Typography.Title level={5}>任务说明</Typography.Title>
        {textRows(description.details)}
        <details className="task-source"><summary>原始需求来源</summary>{(task.source_refs??[]).map((ref,i)=><div key={i}>{ref}</div>)}</details>
        <Typography.Title level={5}>关联线框</Typography.Title>
        {loading && <Spin tip="加载原始需求线框"><div style={{height:60}}/></Spin>}
        {error && <Alert type="warning" title={error}/>}
        {!loading && !error && !wire?.count && <Typography.Paragraph type="secondary">{task.requirement_version_id ? '原始需求未提供可展示的线框。' : '该任务尚未关联原始需求 HTML。'}</Typography.Paragraph>}
        {wire?.count ? <>{wire.fallback && <Alert type="info" title="任务未提供精确线框引用，以下展示原需求线框作为上下文。"/>}<div className="chat-document-reader"><AutoHeightDocument html={wire.html} title={task.id+' 关联原始线框'}/></div></> : null}
        {task.last_result && <details className="task-result"><summary>最近执行结果</summary><Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{task.last_result}</Typography.Paragraph></details>}
        <Typography.Title level={5}>交付内容与验收标准</Typography.Title>
        {textRows(description.delivery)}
        <div className="task-delivery-criteria"><dl className="task-text-rows">{Object.entries(criteriaLabels).map(([kind,label])=>row(label,task.criteria?.find(c=>c.kind===kind)?.text??'未填写',kind))}</dl></div>
        <details className="task-edit-history"><summary>修改历史 · 修订 {task.content_revision??0}</summary>{!task.edit_history?.length ? <p>暂无人工修改。</p> : task.edit_history.map(h=><div key={h.revision}><strong>修订 {h.revision} · {h.actor} · {new Date(h.created_at).toLocaleString()}</strong><p>{criteriaLabels[h.field]??({scope:'任务范围',start:'启动条件',deliverable:'交付内容',completion:'完成条件',title:'交付名称',dependencies:'任务依赖'} as Record<string,string>)[h.field]}</p><div>修改前：{Array.isArray(h.before_value)?h.before_value.map(id=>tasks.find(t=>t.task_uuid===id)?.id??id).join('、'):h.before_value||'未填写'}</div><div>修改后：{Array.isArray(h.after_value)?h.after_value.map(id=>tasks.find(t=>t.task_uuid===id)?.id??id).join('、'):h.after_value}</div>{h.reason && <p>修改原因：{h.reason}</p>}</div>)}</details>
    </div>;
}
