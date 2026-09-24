import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Inbox, fixture, jiraEvent, post } from './support.js';

test('Persistent orchestration waits for Art review, then starts Development and QA with one comment per execution', { timeout: 20000 }, async context =>
{
    const app = await fixture(context, { projects: ['GAME'], heartbeatMs: 100 });
    let transport;
    app.app.server.on('upgrade', (_, socket) => transport = socket);
    const executable = fileURLToPath(new URL('../../GameCLI/Tests/GameCLI.DeliverySmoke/bin/Release/net8.0/GameCLI.DeliverySmoke.dll', import.meta.url));
    const child = spawn('dotnet', [executable, '--watch-server', app.wsUrl], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    context.after(() => child.kill());
    const inbox = new Inbox();
    let diagnostics = '';
    child.stderr.on('data', bytes => diagnostics += bytes.toString());
    createInterface({ input: child.stdout }).on('line', line => inbox.push(JSON.parse(line)));
    const exited = new Promise((resolve, reject) =>
    {
        child.on('error', reject);
        child.on('exit', code => resolve(code));
    });
    const first = await inbox.next('test.gates', 10000);
    assert.equal(first.calls, 1);
    assert.equal(first.comments, 1);
    assert.equal(first.gates.tasks.find(task => task.role === 'Development').state, 'blocked');
    await assert.rejects(inbox.next('test.gates', 150));
    transport.destroy();
    const reconnected = await inbox.next('test.gates', 5000);
    assert.equal(reconnected.calls, 1);
    assert.equal(reconnected.comments, 1);
    child.stdin.write('complete-art\n');
    await inbox.next('test.art-reviewed');
    const event = jiraEvent('GAME-2', 2);
    event.issue.fields.parent.key = 'GAME-1';
    await post(app, event);
    await post(app, event);
    const next = await inbox.next('test.gates', 10000);
    assert.equal(next.calls, 3);
    assert.equal(next.comments, 3);
    assert.equal(next.gates.tasks.find(task => task.role === 'Development').state, 'complete');
    assert.equal(next.gates.tasks.find(task => task.role === 'QA').state, 'waiting_review');
    await post(app, { ...event, timestamp: 3 });
    const repeated = await inbox.next('test.gates');
    assert.equal(repeated.calls, 3);
    assert.equal(repeated.comments, 3);
    child.stdin.write('stop\n');
    await inbox.next('test.watch-complete');
    assert.equal(await exited, 0, diagnostics);
});
