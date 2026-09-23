import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { EventHub } from './event-hub.js';
import { message, normalizeJiraEvent, parseMessage, projectPattern } from './protocol.js';

function matches(actual, expected)
{
    const left = Buffer.from(actual ?? '');
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

function respond(response, status, payload)
{
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(payload));
}

async function readBody(request)
{
    const chunks = [];
    let size = 0;
    for await (const chunk of request)
    {
        size += chunk.length;
        if (size > 1024 * 1024)
        {
            throw new Error('请求过大。');
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

export function createGameCliServer(options)
{
    const { clientToken, webhookToken, projects, heartbeatMs = 15000, retention = 1000, maxClients = 200 } = options;
    if (typeof clientToken !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(clientToken) || typeof webhookToken !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(webhookToken) || clientToken === webhookToken)
    {
        throw new Error('请配置两个不同的 32 至 256 字符服务令牌，仅使用字母、数字、下划线或横线。');
    }
    if (!Array.isArray(projects) || projects.length < 1 || projects.length > 100 || projects.some(project => !projectPattern.test(project)) || new Set(projects).size !== projects.length)
    {
        throw new Error('请配置有效且不重复的项目编号。');
    }
    if (!Number.isInteger(heartbeatMs) || heartbeatMs < 50 || heartbeatMs > 60000 || !Number.isInteger(retention) || retention < 1 || retention > 10000)
    {
        throw new Error('心跳或事件保留数量无效。');
    }
    const hub = new EventHub(projects, retention);
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
    const clients = new Map();

    function send(socket, envelope)
    {
        if (socket.readyState !== WebSocket.OPEN)
        {
            return;
        }
        if (socket.bufferedAmount > 1024 * 1024)
        {
            // Slow clients reconnect and replay; never accumulate an unbounded send queue.
            socket.terminate();
            return;
        }
        socket.send(JSON.stringify(envelope), error =>
        {
            if (error)
            {
                socket.terminate();
            }
        });
    }

    const server = createServer(async (request, response) =>
    {
        try
        {
            const url = new URL(request.url, 'http://localhost');
            if (request.method === 'GET' && url.pathname === '/health')
            {
                respond(response, 200, { ok: true, protocol_version: 1 });
                return;
            }
            const prefix = '/webhooks/jira/';
            if (request.method !== 'POST' || !url.pathname.startsWith(prefix))
            {
                respond(response, 404, { ok: false });
                return;
            }
            if (!matches(url.pathname.slice(prefix.length), webhookToken))
            {
                respond(response, 401, { ok: false });
                return;
            }
            if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? ''))
            {
                respond(response, 415, { ok: false });
                return;
            }
            const body = await readBody(request);
            const event = normalizeJiraEvent(JSON.parse(body.toString('utf8')));
            const result = event ? hub.publish(event, body) : null;
            if (result && !result.duplicate)
            {
                for (const [socket, client] of clients)
                {
                    if (client.project === event.project_key)
                    {
                        send(socket, result.envelope);
                    }
                }
            }
            // Acceptance means notification transport only, never task execution or completion.
            respond(response, 202, { ok: true, accepted: result !== null, duplicate: result?.duplicate ?? false });
        }
        catch
        {
            if (!response.headersSent && !response.destroyed)
            {
                respond(response, 400, { ok: false, message: '通知格式无效或超过容量。' });
            }
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.on('upgrade', (request, socket, head) =>
    {
        if (request.url !== '/ws' || !matches(request.headers.authorization, 'Bearer ' + clientToken))
        {
            socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        if (sockets.clients.size >= maxClients)
        {
            socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection));
    });

    sockets.on('connection', socket =>
    {
        const client = { project: null, id: null, lastSeen: Date.now(), connectedAt: Date.now() };
        clients.set(socket, client);
        socket.on('error', () => socket.terminate());
        socket.on('close', () => clients.delete(socket));
        send(socket, message('server.welcome', { server_id: hub.serverId, heartbeat_interval_ms: heartbeatMs }));
        socket.on('message', (bytes, binary) =>
        {
            try
            {
                if (binary)
                {
                    throw new Error('只支持文本消息。');
                }
                const incoming = parseMessage(bytes);
                if (incoming.type === 'worker.register' && !client.project)
                {
                    const payload = incoming.payload;
                    if (typeof payload.client_id !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(payload.client_id))
                    {
                        throw new Error('客户端编号无效。');
                    }
                    const resume = hub.resume(payload.project_key, payload.cursor);
                    // Duplicate identities are rejected, rather than two processes sharing one cursor.
                    if ([...clients.values()].some(other => other !== client && other.id === payload.client_id && other.project === payload.project_key))
                    {
                        throw new Error('该客户端编号已连接。');
                    }
                    client.id = payload.client_id;
                    client.project = payload.project_key;
                    client.lastSeen = Date.now();
                    const { replay, ...state } = resume;
                    send(socket, message('worker.registered', { client_id: client.id, project_key: client.project, ...state }));
                    for (const envelope of replay)
                    {
                        send(socket, envelope);
                    }
                }
                else if (incoming.type === 'worker.heartbeat' && client.project)
                {
                    client.lastSeen = Date.now();
                    send(socket, message('server.heartbeat', {}));
                }
                else
                {
                    throw new Error('消息类型不支持或尚未注册。');
                }
            }
            catch
            {
                send(socket, message('server.error', { code: 'protocol_error', message: '注册或消息无效，请核对协议、项目及客户端编号。' }));
                socket.close(1008, 'protocol_error');
            }
        });
    });

    const timer = setInterval(() =>
    {
        for (const [socket, client] of clients)
        {
            if (Date.now() - client.lastSeen > heartbeatMs * 3 || !client.project && Date.now() - client.connectedAt > 10000)
            {
                socket.terminate();
            }
        }
    }, heartbeatMs);
    timer.unref();
    return {
        server,
        hub,
        async close()
        {
            clearInterval(timer);
            for (const socket of sockets.clients)
            {
                socket.terminate();
            }
            await new Promise(resolve => sockets.close(resolve));
            server.closeIdleConnections();
            await new Promise(resolve => server.close(resolve));
        }
    };
}
