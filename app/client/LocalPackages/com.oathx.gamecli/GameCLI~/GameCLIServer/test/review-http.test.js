import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createGameCliServer } from '../src/server.js';
import { handleTrackRequest } from '../dist/track/http.js';

test('human login, origin and CSRF boundaries keep worker credentials out of approvals', async t =>
{
    const app=createGameCliServer({additionalHttpHandler:handleTrackRequest});
    app.server.listen(0,'127.0.0.1');
    await once(app.server,'listening');
    t.after(() => app.close());
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const human=parseEnv(await readFile(new URL('../.env.review-account',import.meta.url),'utf8'));
    const worker=parseEnv(await readFile(new URL('../.env.workflow',import.meta.url),'utf8'));
    const post=(path,body,headers={}) => fetch(base+'/api/track/'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await post('requirements',{})).status,403);
    assert.equal((await post('requirements',{}, {Authorization:'Bearer '+worker.SUBMISSION_TOKEN})).status,409);
    assert.equal((await post('review-decisions',{}, {Authorization:'Bearer '+worker.SUBMISSION_TOKEN})).status,401);
    assert.equal((await post('review-pm-split',{}, {Authorization:'Bearer '+worker.SUBMISSION_TOKEN})).status,401);
    assert.equal((await post('review-task-selection',{}, {Authorization:'Bearer '+worker.SUBMISSION_TOKEN})).status,401);
    assert.equal((await post('review-login',{username:human.USERNAME,password:human.PASSWORD},{Origin:'https://untrusted.example'})).status,403);
    const login=await post('review-login',{username:human.USERNAME,password:human.PASSWORD});
    assert.equal(login.status,200);
    const session=await login.json();
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const headers={Cookie:cookie,'X-GameAI-Review-CSRF':session.csrf};
    assert.equal((await post('review-decisions',{}, {Cookie:cookie})).status,401);
    assert.equal((await post('review-pm-split',{}, {Cookie:cookie})).status,401);
    assert.equal((await post('review-task-selection',{}, {Cookie:cookie})).status,401);
    const unknown={version_id:randomUUID(),revision:'a'.repeat(64),document_hash:'b'.repeat(64),decision:'approved',reason:''};
    assert.equal((await post('review-decisions',unknown,headers)).status,409);
    assert.equal((await post('review-logout',{},headers)).status,200);
    assert.equal((await post('review-decisions',unknown,headers)).status,401);
});
