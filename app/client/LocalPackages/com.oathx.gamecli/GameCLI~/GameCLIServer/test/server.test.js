import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGameCliServer } from '../src/server.js';

test('listener needs no external credentials and rejects removed notification routes', async t =>
{
    const app = createGameCliServer();
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/webhooks/anything', { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await fetch(base + '/events')).status, 404);
    await app.close();
    await app.close();
});

test('handler failure is contained without leaking request contents', async t =>
{
    const messages = [];
    const app = createGameCliServer({
        additionalHttpHandler: async () =>
        {
            throw new Error('private-data');
        },
        log: (...args) => messages.push(args)
    });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    t.after(() => app.close());
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/?token=private-data`);
    assert.equal(response.status, 500);
    assert.ok(!JSON.stringify(messages).includes('private-data'));
    assert.ok(!(await response.text()).includes('private-data'));
});
