import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { Inbox, fixture, jiraEvent, post } from './support.js';

const cli = fileURLToPath(new URL('../../GameCLI/GameCLI/bin/Release/net8.0/GameCLI.dll', import.meta.url));

function startClient(context, app, { maximum = 1, token = app.options.clientToken } = {})
{
    assert.ok(existsSync(cli), '先构建 Release 版本的 GameCLI。');
    const child = spawn('dotnet', [cli, 'orchestrator', '--connect', '--server', app.wsUrl, '--project-key', 'AI9527', '--format', 'json', '--max-events', String(maximum), '--timeout', '15'], {
        windowsHide: true,
        env: { ...process.env, GAMECLI_SERVER_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    context.after(() => child.kill());
    const inbox = new Inbox();
    const lines = [];
    let diagnostics = '';
    child.stderr.on('data', bytes => diagnostics += bytes.toString());
    createInterface({ input: child.stdout }).on('line', line =>
    {
        const value = JSON.parse(line);
        lines.push(value);
        inbox.push(value);
    });
    const exited = new Promise((resolve, reject) =>
    {
        child.on('error', reject);
        child.on('exit', code => resolve({ code, diagnostics }));
    });
    return { child, inbox, lines, exited };
}

test('Real C# CLI receives a Node Webhook event and exits after the requested count', { timeout: 20000 }, async context =>
{
    const app = await fixture(context, { heartbeatMs: 100 });
    const client = startClient(context, app);
    assert.equal((await client.inbox.next('worker.registered')).payload.resync_required, true);
    await post(app, jiraEvent());
    const event = await client.inbox.next('jira.issue_changed');
    assert.equal(event.payload.status.name, '完成');
    assert.equal(event.payload.issue_key, 'AI9527-2');
    assert.equal((await client.exited).code, 0);
    assert.ok(!JSON.stringify(client.lines).includes(app.options.clientToken));
});

test('Real CLI rejects a wrong server token without reconnecting indefinitely', { timeout: 20000 }, async context =>
{
    const app = await fixture(context);
    const client = startClient(context, app, { token: 'wrong-token-'.repeat(4) });
    assert.equal((await client.exited).code, 3);
    assert.equal(client.lines.at(-1).ok, false);
});

test('Real CLI reconnects after transport loss and consumes retained notifications', { timeout: 20000 }, async context =>
{
    const app = await fixture(context, { heartbeatMs: 100 });
    let transport;
    app.app.server.on('upgrade', (_, socket) => transport = socket);
    const client = startClient(context, app, { maximum: 2 });
    await client.inbox.next('worker.registered');
    await post(app, jiraEvent('AI9527-2', 1));
    const first = await client.inbox.next('jira.issue_changed');
    transport.destroy();
    await client.inbox.next('client.reconnecting');
    await post(app, jiraEvent('AI9527-3', 2));
    const registered = await client.inbox.next('worker.registered');
    assert.equal(registered.payload.resync_required, false);
    const second = await client.inbox.next('jira.issue_changed');
    assert.equal(second.payload.sequence, first.payload.sequence + 1);
    assert.equal((await client.exited).code, 0);
});

test('Real CLI identifies server restart instead of reusing an obsolete event cursor', { timeout: 20000 }, async context =>
{
    const app = await fixture(context, { heartbeatMs: 100 });
    const client = startClient(context, app, { maximum: 2 });
    await client.inbox.next('worker.registered');
    await post(app, jiraEvent('AI9527-2', 1));
    const first = await client.inbox.next('jira.issue_changed');
    await app.close();
    await client.inbox.next('client.reconnecting');
    const next = await fixture(context, { ...app.options, port: app.port });
    const registered = await client.inbox.next('worker.registered');
    assert.equal(registered.payload.resync_required, true);
    assert.equal(registered.payload.reason, 'server_restarted');
    await post(next, jiraEvent('AI9527-3', 2));
    const second = await client.inbox.next('jira.issue_changed');
    assert.notEqual(second.payload.server_id, first.payload.server_id);
    assert.equal((await client.exited).code, 0);
});
