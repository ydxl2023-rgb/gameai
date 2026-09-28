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
type DisplayMode = 'inline' | 'fullscreen';
const sidebarButton = document.querySelector<HTMLButtonElement>('#open-sidebar')!;
const inlineButton = document.querySelector<HTMLButtonElement>('#return-inline')!;
const displayError = document.querySelector<HTMLElement>('#display-error')!;
let displayMode: DisplayMode = 'inline';
let availableModes: string[] = [];
let switching = false;
let ready = false;
let busy = false;
let nextId = 0;
let lastUpdate = '';
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function log(text: string)
{
    output.textContent = (output.textContent + new Date().toLocaleTimeString() + ' ' + text + '\n').split('\n').slice(-60).join('\n');
}

function updateDisplayControls()
{
    sidebarButton.hidden = displayMode === 'fullscreen';
    inlineButton.hidden = displayMode !== 'fullscreen';
    sidebarButton.disabled = !ready || switching || !availableModes.includes('fullscreen');
    inlineButton.disabled = !ready || switching || !availableModes.includes('inline');
    document.querySelector('#mode')!.textContent = !embedded ? '独立浏览器预览（不支持侧栏）'
        : !ready ? '等待宿主初始化' : displayMode === 'fullscreen' ? '侧栏模式' : '对话内嵌模式';
    sidebarButton.title = !embedded ? '请在 Codex 内嵌组件中使用' : ready && !availableModes.includes('fullscreen') ? '当前宿主未提供侧栏模式' : '在 Codex 右侧面板打开';
}

function applyHostContext(context: any)
{
    if (context?.displayMode === 'inline' || context?.displayMode === 'fullscreen')
    {
        displayMode = context.displayMode;
    }
    if (Array.isArray(context?.availableDisplayModes))
    {
        availableModes = context.availableDisplayModes.filter((mode: unknown) => mode === 'inline' || mode === 'fullscreen');
    }
    updateDisplayControls();
}

async function requestDisplayMode(mode: DisplayMode)
{
    if (!embedded || !ready || switching || !availableModes.includes(mode))
    {
        return;
    }
    switching = true;
    displayError.textContent = '';
    updateDisplayControls();
    try
    {
        const result = await rpc('ui/request-display-mode', { mode });
        if (result?.mode !== 'inline' && result?.mode !== 'fullscreen')
        {
            throw new Error('宿主未返回有效展示模式。');
        }
        // The host owns display state; never report success based on the requested mode alone.
        displayMode = result.mode;
        if (displayMode !== mode)
        {
            throw new Error('宿主未切换展示模式，已保留当前视图。');
        }
        log(displayMode === 'fullscreen' ? '已切换到侧栏。' : '已返回对话内嵌视图。');
    }
    catch (error)
    {
        displayError.textContent = error instanceof Error ? error.message : '展示模式切换失败。';
        log(displayError.textContent);
    }
    finally
    {
        switching = false;
        updateDisplayControls();
    }
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
    else if (message.method === 'ui/notifications/host-context-changed')
    {
        applyHostContext(message.params);
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
                    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26'
                });
                window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
                ready = true;
                applyHostContext(initialized?.hostContext);
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
sidebarButton.addEventListener('click', () => void requestDisplayMode('fullscreen'));
inlineButton.addEventListener('click', () => void requestDisplayMode('inline'));
updateDisplayControls();
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
