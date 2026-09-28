interface Snapshot
{
    schema_version: number;
    mode: string;
    server_time: string;
    request_id: string;
    tasks: Record<string, string>[];
}
const button = document.querySelector<HTMLButtonElement>('#refresh')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const errorBox = document.querySelector<HTMLElement>('#error')!;
const output = document.querySelector<HTMLElement>('#output')!;
const embedded = window.parent !== window;
let ready = false;
let busy = false;
let nextId = 0;
let lastUpdate = '';
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function log(text: string)
{
    output.textContent = (output.textContent + new Date().toLocaleTimeString() + ' ' + text + '\n').split('\n').slice(-60).join('\n');
}

function failure(error: unknown)
{
    const message = error instanceof TypeError ? '无法连接测试服务，请检查服务是否启动后重试。'
        : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? '请求超时，请检查连接后重试。'
        : error instanceof Error ? error.message : '未知错误';
    connection.textContent = '连接失败／数据可能已过期';
    connection.className = 'error';
    errorBox.textContent = message;
    log(message);
}

function applySnapshot(value: unknown)
{
    const data = value as Snapshot;
    if (!data || data.schema_version !== 1 || data.mode !== 'demo' || typeof data.server_time !== 'string' || typeof data.request_id !== 'string' || !Array.isArray(data.tasks) || data.tasks.length > 100)
    {
        throw new Error('服务返回了不兼容的模拟快照。');
    }
    const fields = ['agent', 'role', 'task', 'status', 'activity', 'elapsed'];
    if (data.tasks.some(task => !task || fields.some(key => typeof task[key] !== 'string')))
    {
        throw new Error('任务字段无效。');
    }
    const rows = document.querySelector('#tasks')!;
    rows.replaceChildren();
    for (const task of data.tasks)
    {
        const row = document.createElement('tr');
        for (const field of fields)
        {
            const cell = document.createElement('td');
            cell.textContent = task[field];
            row.append(cell);
        }
        rows.append(row);
    }
    lastUpdate = data.server_time;
    document.querySelector('#updated')!.textContent = '服务器更新：' + new Date(lastUpdate).toLocaleTimeString();
    connection.textContent = '最近请求成功';
    connection.className = 'ok';
    errorBox.textContent = '';
    log('快照成功 · ' + data.tasks.length + ' 条模拟任务 · 请求 ' + data.request_id);
}

function rpc(method: string, params: unknown): Promise<any>
{
    return new Promise((resolve, reject) =>
    {
        const id = ++nextId;
        const timer = setTimeout(() =>
        {
            pending.delete(id);
            reject(new Error('宿主调用超时：' + method + '。请检查插件连接后重试。'));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
}

window.addEventListener('message', event =>
{
    // Accept only the parent bridge. Data is rendered as text, never executable HTML.
    if (!embedded || event.source !== window.parent || event.data?.jsonrpc !== '2.0')
    {
        return;
    }
    const message = event.data;
    const request = pending.get(message.id);
    if (request)
    {
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error)
        {
            request.reject(new Error(message.error.message ?? '宿主拒绝调用。'));
        }
        else
        {
            request.resolve(message.result);
        }
    }
    else if (message.method === 'ui/notifications/tool-result')
    {
        try
        {
            applySnapshot(message.params?.structuredContent);
        }
        catch (error)
        {
            failure(error);
        }
    }
});

async function refresh()
{
    if (busy)
    {
        return;
    }
    busy = true;
    button.disabled = true;
    button.textContent = '读取中…';
    try
    {
        if (embedded)
        {
            if (!ready)
            {
                const initialized = await rpc('ui/initialize', {
                    appInfo: { name: 'gameai-track', version: '0.1.0' },
                    appCapabilities: {}, protocolVersion: '2026-01-26'
                });
                window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
                ready = true;
                log('宿主桥接初始化成功 · ' + String(initialized?.hostInfo?.name ?? '未提供宿主名称'));
            }
            const result = await rpc('tools/call', { name: 'gameai_track_snapshot', arguments: {} });
            if (result?.isError)
            {
                throw new Error('服务工具返回失败，请检查 MCP 连接。');
            }
            applySnapshot(result?.structuredContent);
        }
        else
        {
            const response = await fetch('/api/track/demo', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!response.ok)
            {
                throw new Error('服务器请求失败：HTTP ' + response.status);
            }
            applySnapshot(await response.json());
        }
    }
    catch (error)
    {
        failure(error);
    }
    finally
    {
        busy = false;
        button.disabled = false;
        button.textContent = '刷新';
    }
}
button.addEventListener('click', () => void refresh());
document.querySelector('#mode')!.textContent = embedded ? '宿主桥接模式' : '独立浏览器预览（非 Codex 验收）';
window.addEventListener('pagehide', () =>
{
    for (const request of pending.values())
    {
        clearTimeout(request.timer);
        request.reject(new Error('组件已关闭。'));
    }
    pending.clear();
});
void refresh();
