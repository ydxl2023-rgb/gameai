import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fixture, jiraEvent, post } from './support.js';

test('JIRA Webhook starts one Art probe through the real C# event listener and keeps heartbeats alive', { timeout: 15000 }, async context =>
{
    const executable = fileURLToPath(new URL('../../GameCLI/Tests/GameCLI.DeliverySmoke/bin/Release/net8.0/GameCLI.DeliverySmoke.dll', import.meta.url));
    assert.ok(existsSync(executable), '请先构建 GameCLI.DeliverySmoke 的 Release 版本。');
    let registered;
    const ready = new Promise(resolve => registered = resolve);
    const logs = [];
    const app = await fixture(context, {
        projects: ['GAME'],
        heartbeatMs: 50,
        logHeartbeats: true,
        log: (message, details) =>
        {
            logs.push({ message, ...details });
            if (details?.replay_count !== undefined)
            {
                registered();
            }
        }
    });
    const child = spawn('dotnet', [executable, '--probe-server', app.wsUrl], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    context.after(() => child.kill());
    let output = '';
    let diagnostics = '';
    child.stdout.on('data', bytes => output += bytes.toString());
    child.stderr.on('data', bytes => diagnostics += bytes.toString());
    const exited = new Promise((resolve, reject) =>
    {
        child.on('error', reject);
        child.on('exit', code => resolve(code));
    });
    await ready;
    const unrelated = jiraEvent('GAME-9');
    unrelated.issue.fields.parent.key = 'GAME-8';
    await post(app, unrelated);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(!diagnostics.includes('正在启动 Art'));
    const related = jiraEvent('GAME-3', 2);
    related.issue.fields.parent.key = 'GAME-1';
    await post(app, related);
    await post(app, related);
    assert.equal(await exited, 0, diagnostics);
    assert.ok(output.includes('PROBE_TRANSPORT_PASS'));
    assert.equal(diagnostics.match(/正在启动 Art/g)?.length, 1);
    assert.ok(logs.filter(item => item.heartbeats > 0 && item.close_code === undefined).length >= 3);
    assert.ok(!logs.some(item => item.message.includes('心跳超时')));
});
