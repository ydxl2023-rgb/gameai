import { useEffect, useRef, useState } from 'react';
import { Checkbox, Input, Typography } from 'antd';
import type { Activity } from './model';

export function WorkflowOutput({events,persistent,logs,error}:{events:Activity[];persistent:boolean;logs:string[];error:string})
{
    const [query,setQuery] = useState('');
    const [follow,setFollow] = useState(true);
    const body = useRef<HTMLPreElement>(null);
    const lines = events.filter(event => [event.requirement,event.task,event.actor,event.message].join(' ').toLowerCase().includes(query.toLowerCase()));
    useEffect(() =>
    {
        if (follow && body.current) body.current.scrollTop = body.current.scrollHeight;
    }, [events,logs,follow,query]);
    return <div className="output">
        <div className="output-title">Output <Typography.Text type="secondary">{persistent ? '工作流事件 · 最近 500 条 · 每 3 秒更新' : '本页模拟日志'}</Typography.Text>
            <Input size="small" aria-label="筛选执行日志" placeholder="需求 / 任务 / Agent" value={query} onChange={e=>setQuery(e.target.value)} allowClear style={{width:180}} />
            <Checkbox checked={follow} onChange={e=>setFollow(e.target.checked)}>跟随最新</Checkbox>
        </div>
        <pre ref={body} aria-label="工作流执行日志" role="log" onScroll={()=>{ const el=body.current; if(el && el.scrollHeight-el.scrollTop-el.clientHeight>40) setFollow(false); }}>
            {error && <div style={{color:'#ff7875'}}>日志连接异常：{error}（保留上次记录，正在重试）</div>}
            {persistent ? lines.length ? lines.map(event=><div key={event.id} style={{color:event.level==='error'?'#ff7875':event.level==='warning'?'#ffc53d':undefined}}>{new Date(event.time).toLocaleString()} [{event.actor}] {event.requirement ? `[需求 ${event.requirement}] ` : ''}{event.task ? `[任务 ${event.task}] ` : ''}{event.message.split('\n')[0]}{event.message.includes('\n') && <details><summary>展开执行详情与交付证据</summary>{event.message.slice(event.message.indexOf('\n')+1)}</details>}</div>) : '暂无匹配的工作流事件' : logs.join('\n') || '等待连接与操作…'}
        </pre>
    </div>;
}
