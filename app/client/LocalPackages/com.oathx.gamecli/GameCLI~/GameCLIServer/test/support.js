import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import WebSocket from 'ws';
import { createGameCliServer } from '../src/server.js';
import { message } from '../src/protocol.js';

export class Inbox
{
    constructor()
    {
        this.frames = [];
        this.waiters = [];
    }

    push(frame)
    {
        const index = this.waiters.findIndex(waiter => waiter.type === frame.type);
        if (index >= 0)
        {
            const waiter = this.waiters.splice(index, 1)[0];
            clearTimeout(waiter.timer);
            waiter.resolve(frame);
        }
        else
        {
            this.frames.push(frame);
        }
    }

    next(type, timeout = 5000)
    {
        const index = this.frames.findIndex(frame => frame.type === type);
        if (index >= 0)
        {
            return Promise.resolve(this.frames.splice(index, 1)[0]);
        }
        return new Promise((resolve, reject) =>
        {
            const waiter = { type, resolve };
            waiter.timer = setTimeout(() =>
            {
                this.waiters.splice(this.waiters.indexOf(waiter), 1);
                reject(new Error('等待消息超时：' + type));
            }, timeout);
            this.waiters.push(waiter);
        });
    }
}

export async function fixture(context, overrides = {})
{
    const options = {
        clientToken: randomBytes(24).toString('hex'),
        webhookToken: randomBytes(24).toString('hex'),
        projects: ['AI9527', 'OTHER'],
        heartbeatMs: 1000,
        ...overrides
    };
    const app = createGameCliServer(options);
    app.server.listen(overrides.port ?? 0, '127.0.0.1');
    await once(app.server, 'listening');
    let closed = false;
    async function close()
    {
        if (!closed)
        {
            closed = true;
            await app.close();
        }
    }
    context.after(close);
    const port = app.server.address().port;
    const base = `http://127.0.0.1:${port}`;
    return { app, options, port, base, wsUrl: `ws://127.0.0.1:${port}/ws`, close };
}

export function jiraEvent(key = 'AI9527-2', time = Date.now())
{
    return {
        webhookEvent: 'jira:issue_updated',
        timestamp: time,
        issue: {
            key,
            fields: {
                project: { key: key.slice(0, key.lastIndexOf('-')) },
                parent: { key: 'AI9527-1' },
                status: { id: '10001', name: '完成' },
                description: '不应通过通知转发的完整需求',
                reporter: { emailAddress: 'private@example.test' }
            }
        },
        changelog: { items: [{ field: 'status', fromString: '进行中', toString: '完成' }] }
    };
}

export async function post(fixture, value, token = fixture.options.webhookToken)
{
    return httpRequest(`${fixture.base}/webhooks/jira/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
    });
}

// JIRA uses HTTP directly; browser fetch port restrictions must not affect ephemeral test listeners.
export function httpRequest(url, options = {})
{
    return new Promise((resolve, reject) =>
    {
        const call = request(url, { method: options.method ?? 'GET', headers: options.headers }, response =>
        {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => resolve({
                status: response.statusCode,
                json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8'))
            }));
        });
        call.setTimeout(5000, () => call.destroy(new Error('HTTP test timeout')));
        call.on('error', reject);
        call.end(options.body);
    });
}

export async function subscriber(context, fixture, { project = 'AI9527', cursor = null, heartbeat = true, id = randomUUID() } = {})
{
    const socket = new WebSocket(fixture.wsUrl, { headers: { Authorization: 'Bearer ' + fixture.options.clientToken } });
    const inbox = new Inbox();
    socket.on('message', bytes => inbox.push(JSON.parse(bytes.toString())));
    socket.on('error', () => {});
    context.after(() => socket.terminate());
    await once(socket, 'open');
    const welcome = await inbox.next('server.welcome');
    socket.send(JSON.stringify(message('worker.register', { client_id: id, project_key: project, cursor })));
    const registered = await inbox.next('worker.registered');
    let timer;
    if (heartbeat)
    {
        timer = setInterval(() =>
        {
            if (socket.readyState === WebSocket.OPEN)
            {
                socket.send(JSON.stringify(message('worker.heartbeat', {})));
            }
        }, fixture.options.heartbeatMs);
        socket.on('close', () => clearInterval(timer));
        context.after(() => clearInterval(timer));
    }
    return { socket, inbox, welcome, registered };
}
