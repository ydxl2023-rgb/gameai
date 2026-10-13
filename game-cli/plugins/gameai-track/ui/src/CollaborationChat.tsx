import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Alert,Avatar,Button,Empty,Input,Select,Space,Tag} from 'antd';
import type {TrackBridge} from './bridge';
import './collaboration.css';

export interface CollaborationMessage
{
    id:string;created_at:string;actor_name:string;role:string;event:string;body:string;level:string;
    requirement_key:string|null;requirement_title:string|null;version:string|null;version_id:string|null;
    task_key:string|null;task_id:string|null;artifact_id:string|null;task_available:boolean;document_available:boolean;
}
const roles:Record<string,string>={Human:'审批人',Orchestrator:'编排器',Design:'策划',PM:'PM',Prefab:'预制',Art:'美术',Development:'开发',QA:'QA'};

export function CollaborationChat({bridge,openTask,openDocument}:{bridge:TrackBridge;openTask:(id:string)=>void;openDocument:(message:CollaborationMessage)=>void})
{
    const [messages,setMessages]=useState<CollaborationMessage[]>([]);
    const [before,setBefore]=useState<string|null>(null);
    const [role,setRole]=useState<string>();
    const [search,setSearch]=useState('');
    const [query,setQuery]=useState('');
    const [error,setError]=useState('');
    const [loading,setLoading]=useState(false);
    const [unread,setUnread]=useState(false);
    const scroll=useRef<HTMLDivElement>(null);
    const bottom=useRef(true);
    const generation=useRef(0);
    const anchor=useRef<{height:number;top:number}|null>(null);
    useEffect(()=>{const t=setTimeout(()=>setQuery(search),350);return()=>clearTimeout(t);},[search]);
    useEffect(()=>
    {
        const epoch=++generation.current;let active=true;let timer:ReturnType<typeof setTimeout>;let initialized=false;let newest:string|undefined;
        setMessages([]);setBefore(null);setUnread(false);bottom.current=true;setLoading(true);
        async function refresh()
        {
            try
            {
                const filters={...role?{role}:{},...query?{search:query}:{}};
                const page=await bridge.collaboration(filters);
                const incoming:CollaborationMessage[]=[...page.messages];
                let cursor=page.before;
                // Catch up across multiple pages after a background pause, without dropping intervening events.
                while(active && newest && cursor && incoming.length && BigInt(incoming[0].id)>BigInt(newest))
                {
                    const olderPage=await bridge.collaboration({...filters,before:cursor});
                    incoming.unshift(...olderPage.messages);cursor=olderPage.before;
                }
                if (!active || generation.current!==epoch) return;
                setMessages(old=>
                {
                    const merged=new Map(old.map(m=>[m.id,m]));
                    let added=false;
                    for (const message of incoming) {if(!merged.has(message.id)) added=true;merged.set(message.id,message);}
                    if (added && !bottom.current) setUnread(true);
                    return [...merged.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
                });
                if(!initialized) setBefore(page.before);
                initialized=true;
                newest=page.messages.at(-1)?.id??newest;
                setError('');
            }
            catch(e) {if(active) setError(e instanceof Error?e.message:'读取失败');}
            finally {if(active){setLoading(false);timer=setTimeout(()=>void refresh(),3000);}}
        }
        void refresh();
        return()=>{active=false;generation.current++;clearTimeout(timer);};
    },[bridge,role,query]);
    useLayoutEffect(()=>
    {
        const node=scroll.current;if(!node)return;
        if(anchor.current){node.scrollTop=anchor.current.top+node.scrollHeight-anchor.current.height;anchor.current=null;}
        else if(bottom.current)node.scrollTop=node.scrollHeight;
    },[messages]);
    async function older()
    {
        if(!before || loading)return;
        const epoch=generation.current;setLoading(true);
        try
        {
            const page=await bridge.collaboration({before,...role?{role}:{},...query?{search:query}:{}});
            if(epoch!==generation.current)return;
            if(scroll.current)anchor.current={height:scroll.current.scrollHeight,top:scroll.current.scrollTop};
            bottom.current=false;
            setMessages(old=>[...new Map([...page.messages,...old].map(m=>[m.id,m])).values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1));
            setBefore(page.before);setError('');
        }
        catch(e){if(epoch===generation.current)setError(String(e));}
        finally{if(epoch===generation.current)setLoading(false);}
    }
    return <div className="collaboration-chat">
        <Space wrap className="collaboration-toolbar">
            <Input aria-label="筛选协作记录" placeholder="需求 / 任务 / 角色名称" value={search} onChange={e=>setSearch(e.target.value)} allowClear style={{width:230}} />
            <Select aria-label="筛选协作角色" placeholder="全部角色" value={role} onChange={setRole} allowClear style={{width:135}} options={Object.entries(roles).map(([value,label])=>({value,label}))} />
            <span className="collaboration-note">只读 · 历史永久保留</span>
        </Space>
        {error && <Alert type="error" title={error} showIcon />}
        <div className="collaboration-messages" ref={scroll} onScroll={()=>{const n=scroll.current;if(n){bottom.current=n.scrollHeight-n.scrollTop-n.clientHeight<50;if(bottom.current)setUnread(false);}}}>
            <div className="collaboration-history"><Button disabled={!before} loading={loading} onClick={()=>void older()}>{before?'加载更早记录':'已显示最早记录'}</Button></div>
            {!messages.length && !loading && <Empty description="暂无协作反馈，流程产生新事件后会自动显示" />}
            {messages.map(m=><article key={m.id} className={'collaboration-message'+(m.role==='Human'?' collaboration-message--human':'')}>
                <Avatar className="collaboration-avatar">{(roles[m.role]??m.actor_name).slice(0,2)}</Avatar>
                <div className="collaboration-content">
                    <div className="collaboration-meta"><strong>{m.actor_name}</strong><span>{roles[m.role]??m.role}</span><time>{new Date(m.created_at).toLocaleString()}</time></div>
                    <div className={'collaboration-bubble collaboration-bubble--'+m.level}>
                        <strong>{m.event}</strong>
                        {m.body && <div className="collaboration-body">{m.body}</div>}
                        <Space wrap className="collaboration-links">
                            {m.requirement_key && <Tag title={m.requirement_title??''}>{m.requirement_key}{m.version?' · '+m.version:''}</Tag>}
                            {m.task_key && (m.task_available?<Button size="small" type="link" onClick={()=>openTask(m.task_id!)}>{m.task_key}</Button>:<span>{m.task_key} · 已归档</span>)}
                            {m.artifact_id && (m.document_available?<Button size="small" type="link" onClick={()=>openDocument(m)}>查看文档</Button>:<span>原文已清理 · 保留历史记录</span>)}
                        </Space>
                    </div>
                </div>
            </article>)}
        </div>
        {unread && <Button className="collaboration-new" onClick={()=>{bottom.current=true;setUnread(false);if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;}}>有新消息，回到底部</Button>}
    </div>;
}
