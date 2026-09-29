import { parseSnapshot, type Snapshot } from './model';
export type DisplayMode = 'inline' | 'fullscreen';
export class TrackBridge
{
    readonly embedded = window.parent !== window;
    mode: DisplayMode = 'inline';
    modes: string[] = [];
    ready = false;
    onContext: () => void = () => {};
    onSnapshot: (snapshot: Snapshot) => void = () => {};
    onError: (error: Error) => void = () => {};
    private nextId = 0;
    private pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    constructor() { window.addEventListener('message', this.receive); }
    private context = (context: any) =>
    {
        if (context?.displayMode === 'inline' || context?.displayMode === 'fullscreen') this.mode = context.displayMode;
        if (Array.isArray(context?.availableDisplayModes)) this.modes = context.availableDisplayModes.filter((x: unknown) => x === 'inline' || x === 'fullscreen');
        this.onContext();
    };
    private receive = (event: MessageEvent) =>
    {
        // Only the parent host can answer bridge requests or supply notifications.
        if (!this.embedded || event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
        const message = event.data;
        const request = this.pending.get(message.id);
        if (request)
        {
            this.pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.error) request.reject(new Error(message.error.message ?? '宿主拒绝调用。'));
            else request.resolve(message.result);
        }
        else if (message.method === 'ui/notifications/host-context-changed') this.context(message.params);
        else if (message.method === 'ui/notifications/tool-result')
        {
            try { this.onSnapshot(parseSnapshot(message.params?.structuredContent)); }
            catch (error) { this.onError(error instanceof Error ? error : new Error('快照错误')); }
        }
    };
    private rpc(method: string, params: unknown, timeout = 10000): Promise<any>
    {
        return new Promise((resolve, reject) =>
        {
            const id = ++this.nextId;
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('宿主调用超时：' + method)); }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
        });
    }
    async refresh(): Promise<Snapshot>
    {
        if (!this.embedded)
        {
            const response = await fetch('/api/track/snapshot', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!response.ok) throw new Error('快照请求失败：HTTP ' + response.status);
            return parseSnapshot(await response.json());
        }
        if (!this.ready)
        {
            const result = await this.rpc('ui/initialize', { appInfo: { name: 'gameai-track', version: '0.2.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' });
            window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
            this.ready = true;
            this.context(result?.hostContext);
        }
        const result = await this.rpc('tools/call', { name: 'gameai_track_snapshot', arguments: {} });
        if (result?.isError) throw new Error('快照工具返回失败。');
        return parseSnapshot(result?.structuredContent);
    }
    async display(mode: DisplayMode)
    {
        if (!this.ready || !this.modes.includes(mode)) throw new Error('当前宿主不支持该展示模式。');
        const result = await this.rpc('ui/request-display-mode', { mode });
        if (result?.mode !== 'inline' && result?.mode !== 'fullscreen') throw new Error('宿主未返回有效展示模式。');
        this.context({ displayMode: result.mode });
        if (result.mode !== mode) throw new Error('宿主未切换展示模式，已保留当前视图。');
    }
    async history(agent: string, conversation?: string, page = 1)
    {
        if (!this.embedded)
        {
            const query = new URLSearchParams({ agent, page: String(page) });
            if (conversation) query.set('conversation', conversation);
            const response = await fetch('/api/track/agent-history?' + query, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? '历史读取失败。');
            return body;
        }
        const result = await this.rpc('tools/call', { name: 'gameai_agent_history', arguments: { agent, conversation, page } }, 25000);
        if (result?.isError) throw new Error(result.content?.[0]?.text ?? '历史读取失败。');
        return result.structuredContent;
    }
    dispose()
    {
        window.removeEventListener('message', this.receive);
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('组件已关闭。')); }
        this.pending.clear();
    }
}
