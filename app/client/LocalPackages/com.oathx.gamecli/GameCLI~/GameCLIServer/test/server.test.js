import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { message } from '../src/protocol.js';
import { fixture, httpRequest, jiraEvent, post, subscriber } from './support.js';

test('Webhook routes minimal Chinese status events only to the subscribed project', async context =>
{
    const app = await fixture(context);
    const first = await subscriber(context, app);
    const other = await subscriber(context, app, { project: 'OTHER' });
    assert.equal(first.registered.payload.resync_required, true);
    assert.equal((await post(app, jiraEvent())).status, 202);
    const event = await first.inbox.next('jira.issue_changed');
    assert.equal(event.payload.issue_key, 'AI9527-2');
    assert.deepEqual(event.payload.status_change, { from: '进行中', to: '完成' });
    assert.equal(event.payload.parent_key, 'AI9527-1');
    assert.ok(!JSON.stringify(event).includes('private@example.test'));
    assert.ok(!JSON.stringify(event).includes('完整需求'));
    await assert.rejects(other.inbox.next('jira.issue_changed', 100));
});

test('Webhook and WebSocket credentials are independent and required', async context =>
{
    const app = await fixture(context);
    assert.equal((await post(app, jiraEvent(), app.options.clientToken)).status, 401);
    const socket = new WebSocket(app.wsUrl, { headers: { Authorization: 'Bearer ' + app.options.webhookToken } });
    context.after(() => socket.terminate());
    const [error] = await once(socket, 'error');
    assert.match(error.message, /401/);
});

test('Identical notifications are deduplicated within the replay window', async context =>
{
    const app = await fixture(context);
    const client = await subscriber(context, app);
    const body = jiraEvent();
    await post(app, body);
    const result = await (await post(app, body)).json();
    assert.equal(result.duplicate, true);
    assert.equal((await client.inbox.next('jira.issue_changed')).payload.sequence, 1);
    await assert.rejects(client.inbox.next('jira.issue_changed', 100));
});

test('Reconnect replays retained project events in order', async context =>
{
    const app = await fixture(context);
    const first = await subscriber(context, app);
    await post(app, jiraEvent('AI9527-2', 1));
    const event = await first.inbox.next('jira.issue_changed');
    first.socket.close();
    await once(first.socket, 'close');
    await post(app, jiraEvent('AI9527-3', 2));
    const next = await subscriber(context, app, { cursor: { server_id: event.payload.server_id, sequence: 1 } });
    assert.equal(next.registered.payload.resync_required, false);
    assert.equal((await next.inbox.next('jira.issue_changed')).payload.sequence, 2);
});

test('Expired cursors and server restarts explicitly require JIRA reconciliation', async context =>
{
    const app = await fixture(context, { retention: 1 });
    await post(app, jiraEvent('AI9527-2', 1));
    await post(app, jiraEvent('AI9527-3', 2));
    const gap = await subscriber(context, app, { cursor: { server_id: app.app.hub.serverId, sequence: 0 } });
    assert.equal(gap.registered.payload.reason, 'replay_gap');
    assert.equal(gap.registered.payload.resync_required, true);
    const restarted = await subscriber(context, app, { cursor: { server_id: 'old-server', sequence: 1 } });
    assert.equal(restarted.registered.payload.reason, 'server_restarted');
    assert.equal(restarted.registered.payload.resync_required, true);
});

test('Malformed notifications fail and unrelated events/projects are ignored', async context =>
{
    const app = await fixture(context);
    assert.equal((await post(app, { ...jiraEvent(), timestamp: null })).status, 400);
    assert.equal((await (await post(app, { webhookEvent: 'comment_created' })).json()).accepted, false);
    assert.equal((await (await post(app, jiraEvent('UNRELATED-1'))).json()).accepted, false);
    assert.equal((await httpRequest(app.base + '/health')).status, 200);
});

test('A client cannot send task assignments or incompatible protocol messages', async context =>
{
    const app = await fixture(context);
    const client = await subscriber(context, app);
    client.socket.send(JSON.stringify(message('task.assign', { issue_key: 'AI9527-3' })));
    assert.equal((await client.inbox.next('server.error')).payload.code, 'protocol_error');
    const second = await subscriber(context, app);
    second.socket.send(JSON.stringify({ ...message('worker.heartbeat', {}), protocol_version: 999 }));
    assert.equal((await second.inbox.next('server.error')).payload.code, 'protocol_error');
});

test('Heartbeat keeps active clients alive and evicts silent connections', async context =>
{
    const app = await fixture(context, { heartbeatMs: 50 });
    const active = await subscriber(context, app);
    const silent = await subscriber(context, app, { heartbeat: false });
    await once(silent.socket, 'close');
    assert.equal(active.socket.readyState, WebSocket.OPEN);
    assert.equal((await active.inbox.next('server.heartbeat')).protocol_version, 1);
});

test('Fifty clients receive one event without separate JIRA polling', async context =>
{
    const app = await fixture(context);
    const clients = await Promise.all(Array.from({ length: 50 }, () => subscriber(context, app)));
    await post(app, jiraEvent());
    const results = await Promise.all(clients.map(client => client.inbox.next('jira.issue_changed')));
    assert.equal(results.length, 50);
    assert.equal(new Set(results.map(result => result.message_id)).size, 1);
});

test('Shutdown closes connected WebSocket clients', async context =>
{
    const app = await fixture(context);
    const client = await subscriber(context, app);
    const closed = once(client.socket, 'close');
    await app.close();
    await closed;
    assert.equal(client.socket.readyState, WebSocket.CLOSED);
});
