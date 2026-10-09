import { spawn } from 'node:child_process';

// Only public conversational items leave this boundary. Never return raw thread objects.
export function publicMessages(thread)
{
    const messages = [];
    for (const turn of thread.turns ?? [])
    {
        for (const item of turn.items ?? [])
        {
            let text;
            if (item.type === 'userMessage')
            {
                text = (item.content ?? []).map(part => part.type === 'text' ? part.text : '[非文本内容]').join('\n');
            }
            else if (item.type === 'agentMessage')
            {
                text = item.text;
            }
            else
            {
                continue;
            }
            messages.push({ id: `${turn.id}:${item.id ?? messages.length}`, role: item.type === 'userMessage' ? 'user' : 'assistant',
                text: typeof text === 'string' ? text : '', turn_id: turn.id, status: turn.status });
        }
    }
    return messages;
}

export function readConversation(threadId)
{
    return new Promise((resolve, reject) =>
    {
        const process = spawn(globalThis.process.env.GAMEAI_CODEX_PATH ?? 'codex', ['app-server'], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
        let buffer = '';
        let size = 0;
        let settled = false;
        const finish = (error, value) =>
        {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            process.stdin.end();
            process.kill();
            if (error) { reject(new Error(error)); }
            else { resolve(value); }
        };
        const timer = setTimeout(() => finish('会话读取超时，请重试。'), 20000);
        const send = value => process.stdin.write(JSON.stringify(value)+'\n');
        process.on('error', () => finish('本机 Codex 无法启动，请检查安装与服务账户。'));
        process.stdin.on('error', () => finish('Codex 会话连接已断开。'));
        process.on('close', () => finish('Codex 未返回会话记录。'));
        process.stderr.resume();
        process.stdout.setEncoding('utf8');
        process.stdout.on('data', chunk =>
        {
            size += Buffer.byteLength(chunk);
            if (size > 32*1024*1024) { finish('会话超过读取上限，请在 Codex 中查看原会话。'); return; }
            buffer += chunk;
            let split;
            while ((split = buffer.indexOf('\n')) >= 0 && !settled)
            {
                const line = buffer.slice(0,split);
                buffer = buffer.slice(split+1);
                let message;
                try { message = JSON.parse(line); }
                catch { finish('Codex 会话协议无效。'); return; }
                if (message.id !== 1 && message.id !== 2) { continue; }
                if (message.error) { finish('原会话暂不可读取，可能已删除、归档或不属于当前服务账户。'); return; }
                if (message.id === 1)
                {
                    send({method:'initialized',params:{}});
                    send({id:2,method:'thread/read',params:{threadId,includeTurns:true}});
                }
                else if (message.result?.thread?.id === threadId)
                {
                    finish(null,publicMessages(message.result.thread));
                }
                else { finish('返回的会话编号不匹配。'); }
            }
        });
        send({id:1,method:'initialize',params:{clientInfo:{name:'gameai-history',version:'0.1.0'}}});
    });
}
