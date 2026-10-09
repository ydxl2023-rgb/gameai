import { parseReadableMessage } from './readable-message';
import { useEffect, useState } from 'react';
import { Alert, Avatar, Button, Empty, Pagination, Select, Space, Spin, Typography } from 'antd';
import { AutoHeightDocument } from './AutoHeightDocument';
import type { TrackBridge } from './bridge';
interface Conversation { id: string; requirement_key: string; thread_id: string | null; }
interface Message { id: string; role: string; text: string; turn_id: string; status: string; }
interface History { messages: Message[]; total: number; page_size: number; thread_id: string; }
export function AgentHistory({ agent, bridge, requirementKey }: { agent: string; bridge: TrackBridge | null; requirementKey?:string })
{
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selected, setSelected] = useState<string>();
    const [page, setPage] = useState(1);
    const [revision, setRevision] = useState(0);
    const [history, setHistory] = useState<History>();
    const [listing, setListing] = useState(true);
    const [reading, setReading] = useState(false);
    const loading = listing || reading;
    const [error, setError] = useState('');
    useEffect(() =>
    {
        let active = true;
        setListing(true);
        setError('');
        if (!bridge) return;
        bridge.history(agent).then(result =>
        {
            if (!active) return;
            setConversations(result.conversations);
            setSelected(previous => requirementKey ? result.conversations.find((c:Conversation)=>c.requirement_key===requirementKey)?.id : result.conversations.some((c: Conversation) => c.id === previous) ? previous : result.conversations[0]?.id);
        }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setListing(false); });
        return () => { active = false; };
    }, [agent, bridge, revision, requirementKey]);
    useEffect(() =>
    {
        let active = true;
        setHistory(undefined);
        if (!selected || !bridge) return;
        setReading(true);
        setError('');
        bridge.history(agent, selected, page).then(result => { if (active) setHistory(result); })
            .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setReading(false); });
        return () => { active = false; };
    }, [agent, bridge, selected, page, revision]);
    return <section style={{ marginTop: 24 }} aria-label="对话历史">
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>对话历史</Typography.Title>
            <Button size="small" disabled={loading} onClick={() => setRevision(r => r + 1)}>刷新历史</Button>
        </Space>
        <Typography.Paragraph type="secondary">按需求隔离会话，展示已保存的用户消息和 Agent 回复。</Typography.Paragraph>
        {!!conversations.length && <Select aria-label="需求会话" value={selected} style={{ width: '100%', marginBottom: 12 }}
            options={conversations.map(c => ({ value: c.id, label: c.requirement_key + (c.thread_id ? ' · ' + c.thread_id : ' · 尚未启动') }))}
            onChange={id => { setSelected(id); setPage(1); }} />}
        {!loading && requirementKey && !selected && <Alert type="info" title="该任务对应需求尚无可读取的 Agent 会话" />}
        {error && <Alert type="warning" title="历史暂不可用" description={error} showIcon />}
        {loading && <Spin description="读取会话历史" style={{ display: 'block', padding: 20 }}><div style={{ height: 20 }} /></Spin>}
        {!loading && !error && !conversations.length && <Empty description="这个 Agent 尚无已关联的会话" />}
        {!loading && !error && history && !history.total && <Empty description="会话尚无已保存的对话消息" />}
        {history && !error && <>
            <Typography.Paragraph type="secondary" style={{ overflowWrap: 'anywhere' }}>会话：{history.thread_id} · 共 {history.total} 条消息</Typography.Paragraph>
            <div className="agent-chat" aria-label="聊天记录">
                {history.messages.map(m => <ChatMessage key={m.id} message={m} agent={agent} />)}
            </div>
            <Pagination size="small" current={page} total={history.total} pageSize={history.page_size} showSizeChanger={false} onChange={setPage} style={{ marginTop: 16 }} />
        </>}
    </section>;
}

function ChatMessage({ message, agent }: { message: Message; agent: string })
{

    const user = message.role === 'user';
    const parsed = user ? parseReadableMessage(message.text) : undefined;
    let readable = parsed?.text ?? message.text;
    let title = parsed?.title ?? '';
    let documentHtml = parsed?.html ?? '';
    let structured = !!parsed;
    if (!user)
    {
        try
        {
            const value = JSON.parse(message.text);
            if (value && typeof value.summary === 'string')
            {
                title = typeof value.title === 'string' ? value.title : '';
                readable = value.summary;
                documentHtml = typeof value.html === 'string' ? value.html : '';
                structured = true;
            }
        }
        catch { /* Plain conversational replies are rendered unchanged. */ }
    }
    const [expanded, setExpanded] = useState(!user && Boolean(documentHtml));
    const [documentOpen, setDocumentOpen] = useState(false);
    const long = readable.length > 900;
    return <article className={`chat-message ${user ? 'chat-message--user' : 'chat-message--assistant'}`} aria-label={user ? '用户消息' : 'Agent 回复'}>
        <div className="chat-author"><Avatar size={24}>{user ? '你' : 'AI'}</Avatar><span>{user ? '你' : agent}</span></div>
        <div className="chat-bubble">
            {title && <div className="chat-title">{title}</div>}
            <div className="chat-text">{expanded ? readable : long ? readable.slice(0, 900) + '…' : readable || (parsed ? '' : '（空消息）')}</div>
            {parsed?.sections.map((section,index)=><section key={index} className="chat-readable-section"><Typography.Text strong>{section.title}</Typography.Text><div className="chat-text">{section.text}</div></section>)}
            {documentHtml && <div className="chat-document">策划文档 · 保留原始排版、目录与线框图</div>}
            {(long || (!user && documentHtml)) && <Button type="text" size="small" className="chat-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : documentHtml ? '阅读完整文档' : '展开完整消息'}</Button>}
            {user && documentHtml && <Button type="link" className="chat-expand" onClick={()=>setDocumentOpen(!documentOpen)}>{documentOpen ? '收起需求文档' : '查看需求文档'}</Button>}
            {documentHtml && (user ? documentOpen : expanded) && <div className="chat-document-reader">
                <AutoHeightDocument html={documentHtml} title={title ? title + ' · 对话文档预览' : '对话文档预览'} />

            </div>}
            {parsed?.technical && <details className="chat-source-toggle"><summary>执行信息与附加上下文</summary><pre className="chat-source">{parsed.technical}</pre></details>}
            {structured && <details className="chat-source-toggle">
                <summary>{user ? '原始消息' : '调试信息'}</summary>
                <Typography.Paragraph type="secondary">完整原始数据（含 JSON 或 HTML 源码），仅供只读排查，不影响文档或审批状态。</Typography.Paragraph>
                <Typography.Paragraph copyable={{text:message.text}}>复制原文</Typography.Paragraph><pre className="chat-source">{message.text}</pre>
            </details>}
        </div>
    </article>;
}