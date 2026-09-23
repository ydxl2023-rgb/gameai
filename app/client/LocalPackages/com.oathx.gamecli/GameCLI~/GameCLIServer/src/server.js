import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
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
    const { webhookToken, projects, heartbeatMs = 15000, retention = 1000, maxClients = 200, log: writeLog = () => {}, logHeartbeats = false } = options;
    if (typeof webhookToken !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(webhookToken))
    {
        throw new Error('请配置 32 至 256 字符的 JIRA 通知令牌，仅使用字母、数字、下划线或横线。');
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
    const totals = { requests: 0, notifications: 0, accepted: 0, ignored: 0, duplicates: 0, rejected: 0, sent: 0, sendFailures: 0 };
    function log(text, details = {})
    {
        writeLog(text, { server_id: hub.serverId, ...details });
    }
    function clientDetails(socket)
    {
        const client = clients.get(socket);
        return { connection_id: client?.connectionId, client_id: client?.id, project_key: client?.project, remote_address: client?.remoteAddress };
    }

    function send(socket, envelope)
    {
        if (socket.readyState !== WebSocket.OPEN)
        {
            return;
        }
        if (socket.bufferedAmount > 1024 * 1024)
        {
            log('客户端发送缓冲区超过限制，断开后等待重连。', { level: 'warn', ...clientDetails(socket), buffered_bytes: socket.bufferedAmount });
            // Slow clients reconnect and replay; never accumulate an unbounded send queue.
            socket.terminate();
            return;
        }
        socket.send(JSON.stringify(envelope), error =>
        {
            if (error)
            {
                totals.sendFailures++;
                log('消息发送失败，断开客户端。', { level: 'error', ...clientDetails(socket), message_id: envelope.message_id, message_type: envelope.type });
                socket.terminate();
            }
            else if (envelope.type === 'jira.issue_changed')
            {
                totals.sent++;
                log('JIRA 通知已写入客户端连接，尚不代表客户端已处理。', { ...clientDetails(socket), message_id: envelope.message_id, issue_key: envelope.payload.issue_key, sequence: envelope.payload.sequence });
            }
        });
    }

    const server = createServer(async (request, response) =>
    {
        const started = Date.now();
        const requestId = randomUUID();
        const context = { request_id: requestId, remote_address: request.socket.remoteAddress, method: request.method };
        totals.requests++;
        function requestLog(text, details = {})
        {
            log(text, { ...context, ...details });
        }
        requestLog('收到 HTTP 请求。');
        response.once('finish', () =>
        {
            requestLog('HTTP 请求处理完成。', { status: response.statusCode, duration_ms: Date.now() - started });
        });
        response.once('close', () =>
        {
            if (!response.writableFinished)
            {
                requestLog('HTTP 连接提前断开，响应未完成。', { level: 'warn', duration_ms: Date.now() - started });
            }
        });
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
                totals.rejected++;
                requestLog('请求被拒绝：地址或请求方法不匹配。', { status: 404 });
                respond(response, 404, { ok: false });
                return;
            }
            if (!matches(url.pathname.slice(prefix.length), webhookToken))
            {
                totals.rejected++;
                requestLog('JIRA 通知被拒绝：通知令牌不匹配。', { status: 401 });
                respond(response, 401, { ok: false });
                return;
            }
            if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? ''))
            {
                log('JIRA 通知被拒绝：正文类型必须为 application/json。', { status: 415 });
                respond(response, 415, { ok: false });
                return;
            }
            totals.notifications++;
            requestLog('收到 JIRA 回调，令牌校验通过，正在读取正文。');
            const body = await readBody(request);
            const value = JSON.parse(body.toString('utf8'));
            const event = normalizeJiraEvent(value);
            requestLog('JIRA 通知正文解析完成。', { body_bytes: body.length, event_name: event?.event_name ?? '不支持的事件', issue_key: event?.issue_key, project_key: event?.project_key, status: event?.status, status_change: event?.status_change, jira_timestamp: event?.jira_timestamp });
            const result = event ? hub.publish(event, body) : null;
            let recipients = 0;
            if (result && !result.duplicate)
            {
                for (const [socket, client] of clients)
                {
                    if (client.project === event.project_key)
                    {
                        if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount <= 1024 * 1024)
                        {
                            recipients++;
                        }
                        send(socket, result.envelope);
                    }
                }
            }
            const outcome = !event ? '忽略 JIRA 通知：事件类型不支持。' : !result ? '忽略 JIRA 通知：项目不在配置范围。' : result.duplicate ? '忽略 JIRA 重复通知。' : '已接收 JIRA 通知并尝试推送。';
            if (!result)
            {
                totals.ignored++;
            }
            else if (result.duplicate)
            {
                totals.duplicates++;
            }
            else
            {
                totals.accepted++;
            }
            requestLog(outcome, { message_id: result?.envelope.message_id, sequence: result?.envelope.payload.sequence, issue_key: event?.issue_key, project_key: event?.project_key, recipients, connected_clients: clients.size });
            // Acceptance means notification transport only, never task execution or completion.
            respond(response, 202, { ok: true, accepted: result !== null, duplicate: result?.duplicate ?? false });
        }
        catch
        {
            if (!response.headersSent && !response.destroyed)
            {
                log('JIRA 通知被拒绝：正文格式无效或超过容量。', { status: 400 });
                respond(response, 400, { ok: false, message: '通知格式无效或超过容量。' });
            }
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.on('upgrade', (request, socket, head) =>
    {
        if (request.url !== '/ws')
        {
            log('客户端连接被拒绝：WebSocket 地址必须为 /ws。', { level: 'warn', remote_address: socket.remoteAddress, status: 404 });
            socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        if (sockets.clients.size >= maxClients)
        {
            log('客户端连接被拒绝：连接数量达到上限。', { level: 'warn', remote_address: socket.remoteAddress, max_clients: maxClients, status: 503 });
            socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection, request));
    });

    sockets.on('connection', (socket, request) =>
    {
        const client = { connectionId: randomUUID(), remoteAddress: request.socket.remoteAddress, heartbeats: 0, project: null, id: null, lastSeen: Date.now(), connectedAt: Date.now() };
        clients.set(socket, client);
        log('客户端已连接，等待项目注册。', { ...clientDetails(socket), connected_clients: clients.size });
        socket.on('error', () =>
        {
            log('客户端连接发生传输错误。', { level: 'error', ...clientDetails(socket) });
            socket.terminate();
        });
        socket.on('close', code =>
        {
            const details = clientDetails(socket);
            clients.delete(socket);
            log('客户端已断开。', { ...details, close_code: code, duration_ms: Date.now() - client.connectedAt, heartbeats: client.heartbeats, connected_clients: clients.size });
        });
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
                    log('客户端已注册项目订阅。', { ...clientDetails(socket), replay_count: replay.length, resync_required: state.resync_required, resume_reason: state.reason, sequence: state.resume_sequence });
                    send(socket, message('worker.registered', { client_id: client.id, project_key: client.project, ...state }));
                    for (const envelope of replay)
                    {
                        send(socket, envelope);
                    }
                }
                else if (incoming.type === 'worker.heartbeat' && client.project)
                {
                    client.lastSeen = Date.now();
                    client.heartbeats++;
                    if (logHeartbeats)
                    {
                        log('收到客户端心跳，正在应答。', { ...clientDetails(socket), heartbeats: client.heartbeats });
                    }
                    send(socket, message('server.heartbeat', {}));
                }
                else
                {
                    throw new Error('消息类型不支持或尚未注册。');
                }
            }
            catch
            {
                log('客户端消息被拒绝：协议、项目或客户端编号无效。', { level: 'warn', ...clientDetails(socket) });
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
                log(client.project ? '客户端心跳超时，正在断开。' : '客户端注册超时，正在断开。', { level: 'warn', ...clientDetails(socket), idle_ms: Date.now() - client.lastSeen });
                socket.terminate();
            }
        }
    }, heartbeatMs);
    timer.unref();
    const summaryTimer = setInterval(() =>
    {
        log('服务运行统计。', { ...totals, connected_clients: clients.size, registered_clients: [...clients.values()].filter(client => client.project).length });
    }, 60000);
    summaryTimer.unref();
    return {
        server,
        hub,
        async close()
        {
            log('正在关闭服务。', { ...totals, connected_clients: clients.size });
            clearInterval(summaryTimer);
            clearInterval(timer);
            for (const socket of sockets.clients)
            {
                socket.terminate();
            }
            await new Promise(resolve => sockets.close(resolve));
            server.closeIdleConnections();
            await new Promise(resolve => server.close(resolve));
            log('服务已关闭。');
        }
    };
}
