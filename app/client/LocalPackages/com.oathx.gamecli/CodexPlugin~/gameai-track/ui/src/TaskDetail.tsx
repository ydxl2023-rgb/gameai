import { useEffect, useState } from 'react';
import { Alert, Button, Progress, Spin, Typography } from 'antd';
import type { Task } from './model';
import type { TrackBridge } from './bridge';
import { StateTag, TaskLinks } from './components';
import { AutoHeightDocument } from './AutoHeightDocument';
import { taskDescription, taskWireframes } from './task-document';

const taskLabels:Record<string,string> = {来源:'需求来源',范围:'任务范围',依赖:'任务依赖',前置依赖:'任务依赖',条件:'启动条件',交付物:'交付内容',操作与处理:'操作处理'};
function TaskTextRows({lines}: {lines:string[]})
{
    return <dl className="task-text-rows">{lines.map((line,i)=>{
        const match=/^([^：:]+)[:：]\s*([\s\S]*)$/.exec(line.trim());
        return match ? <div className="task-text-row" key={i}><dt>{taskLabels[match[1]] ?? match[1]}：</dt><dd>{match[2]}</dd></div> : <div className="task-text-plain" key={i}>{line}</div>;
    })}</dl>;
}

export function TaskDetail({task, tasks, bridge, select, dispatch, dispatchDisabled}: {
    task:Task; tasks:Task[]; bridge:TrackBridge|null; select:(task:Task)=>void; dispatch:()=>void; dispatchDisabled:boolean;
})
{
    const [wire, setWire] = useState<ReturnType<typeof taskWireframes>>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
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
        <Typography.Title level={5}>{task.title}</Typography.Title>
        <div className="task-detail-meta">
            <Button type="primary" size="small" disabled={dispatchDisabled} onClick={dispatch}>派发此任务</Button>
            <StateTag value={task.status}/>
            <span>版本：<strong>{task.version}</strong></span>
            <span>Agent：<strong>{task.agent ?? '未分配'}</strong></span>
            <span className="task-detail-deps">依赖：<TaskLinks ids={task.dependencies} tasks={tasks} select={select}/></span>
        </div>
        <Progress percent={task.progress} size="small"/>
        {task.repair && <Alert type="warning" title="返修任务" description={<><TaskLinks ids={[task.repair.source_task,task.repair.qa_task]} tasks={tasks} select={select}/><div>绑定 Agent：{task.bound_agent ?? '未记录'} · 第 {task.repair.rounds} 轮</div>{task.repair.details.actual}</>}/>}
        <Typography.Title level={5}>任务说明</Typography.Title>
        <TaskTextRows lines={description.details}/>
        <details className="task-source"><summary>原始需求来源</summary>{(task.source_refs??[]).map((ref,i)=><div key={i}>{ref}</div>)}</details>
        <Typography.Title level={5}>关联线框</Typography.Title>
        {loading && <Spin tip="加载原始需求线框"><div style={{height:60}}/></Spin>}
        {error && <Alert type="warning" title={error}/>}
        {!loading && !error && !wire?.count && <Typography.Paragraph type="secondary">{task.requirement_version_id ? '原始需求未提供可展示的线框。' : '该任务尚未关联原始需求 HTML。'}</Typography.Paragraph>}
        {wire?.count ? <>{wire.fallback && <Alert type="info" title="任务未提供精确线框引用，以下展示原需求线框作为上下文。"/>}<div className="chat-document-reader"><AutoHeightDocument html={wire.html} title={task.id+' 关联原始线框'}/></div></> : null}
        {task.last_result && <details className="task-result"><summary>最近执行结果</summary><Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{task.last_result}</Typography.Paragraph></details>}
        <Typography.Title level={5}>交付内容与验收标准</Typography.Title>
        <TaskTextRows lines={description.delivery}/>
        <div className="task-delivery-criteria"><TaskTextRows lines={(task.criteria??[]).map(c=>(({preconditions:'前置条件',steps:'操作处理',success:'成功结果',failure:'失败提示',recovery:'异常恢复',tests:'测试用例'} as Record<string,string>)[c.kind]??c.kind)+'：'+c.text)}/></div>
    </div>;
}
