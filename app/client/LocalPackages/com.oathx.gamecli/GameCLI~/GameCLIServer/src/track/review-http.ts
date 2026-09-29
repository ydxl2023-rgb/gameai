import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createPool, databaseEnabled } from '../database/connection.js';
import { submitRequirement, reviewRequirement, ReviewError } from '../database/requirements.js';
import { agentRunRequest } from '../database/agent-runs.js';
import { startPmJob } from '../database/pm-plans.js';
import { checkPmRuntime, dispatchPmJob } from './pm-dispatch.js';

let writer: ReturnType<typeof createPool> | undefined;
let config: Record<string,string | undefined> | undefined;
const sessions = new Map<string,{ user: string; name: string; csrf: string; expires: number }>();
let failures = 0;
let failureWindow = 0;
function reply(response: ServerResponse, status: number, body: unknown)
{
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
}
export async function handleReviewRequest(request: IncomingMessage, response: ServerResponse)
{
    if (!databaseEnabled())
    {
        reply(response,403,{ error:'当前模式不可写入。' });
        return;
    }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const project = process.env.GAMEAI_PROJECT_KEY ?? 'DEMO';
    try
    {
        if (!writer)
        {
            config = parseEnv(await readFile(new URL('../../.env.workflow', import.meta.url),'utf8'));
            if (!config.PGUSER || !config.PGPASSWORD || !config.SUBMISSION_TOKEN)
            {
                throw new Error('Configuration missing');
            }
            writer = createPool({ user:config.PGUSER,password:config.PGPASSWORD });
        }
        // Cookies represent authenticated humans only. Worker submission credentials cannot approve.
        const sessionId = /(?:^|;\s*)gameai_review=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? '')?.[1] ?? '';
        for (const [key,value] of sessions)
        {
            if (value.expires < Date.now())
            {
                sessions.delete(key);
            }
        }
        const session = sessions.get(sessionId);
        if (path === '/api/track/review-session' && request.method === 'GET')
        {
            reply(response,200,session ? { authenticated:true, name:session.name, csrf:session.csrf } : { authenticated:false });
            return;
        }
        if (request.method !== 'POST')
        {
            reply(response,405,{ error:'方法不允许。' });
            return;
        }
        if (!request.headers['content-type']?.startsWith('application/json'))
        {
            reply(response,415,{error:'需要 JSON。'});
            return;
        }
        const isSubmission = path === '/api/track/requirements' || path === '/api/track/agent-runs';
        if (isSubmission)
        {
            const supplied = Buffer.from(request.headers.authorization ?? '');
            const expected = Buffer.from('Bearer '+config!.SUBMISSION_TOKEN);
            if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected))
            {
                reply(response,403,{error:'提交凭据无效。'});
                return;
            }
        }
        else if (request.headers.origin !== 'http://'+request.headers.host)
        {
            reply(response,403,{error:'审批请求必须来自同源页面。'});return;
        }
        if (!isSubmission && path !== '/api/track/review-login' && (!session || request.headers['x-gameai-review-csrf'] !== session.csrf))
        {
            reply(response,401,{error:'请先登录人工审批账户。'});return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request)
        {
            size += chunk.length;
            if (size > (isSubmission ? 8*1024*1024 : 8192))
            {
                reply(response,413,{error:'提交过大。'});
                return;
            }
            chunks.push(Buffer.from(chunk));
        }
        let input;
        try
        {
            input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        catch
        {
            reply(response,400,{error:'无效 JSON。'});
            return;
        }
        if (path === '/api/track/review-login')
        {
            if (Date.now()-failureWindow > 60000)
            {
                failureWindow=Date.now();
                failures=0;
            }
            if (failures >= 5)
            {
                reply(response,429,{error:'尝试过多，请稍后再试。'});
                return;
            }
            failures++;
            if (typeof input?.username !== 'string' || typeof input?.password !== 'string' || input.password.length > 200)
            {
                reply(response,400,{error:'登录字段无效。'});
                return;
            }
            const human = (await writer.query(`SELECT u.id,u.display_name,c.password_hash FROM gameai.users u JOIN gameai.human_credentials c ON c.user_id=u.id
                WHERE u.subject=$1 AND u.enabled AND EXISTS(SELECT 1 FROM gameai.user_roles ur JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code
                JOIN gameai.projects p ON p.id=ur.project_id WHERE ur.user_id=u.id AND p.project_key=$2 AND rp.permission_code='requirement.approve')`,[input.username,project])).rows[0];
            const [salt,stored] = (human?.password_hash ?? 'invalid:'+'0'.repeat(64)).split(':');
            const actual = scryptSync(input.password,salt,32);
            const expected = Buffer.from(stored,'hex');
            if (!human || expected.length !== actual.length || !timingSafeEqual(expected,actual))
            {
                reply(response,401,{error:'账户、密码或审批权限无效。'});
                return;
            }
            const id=randomBytes(32).toString('hex');
            if (sessions.size >= 100)
            {
                sessions.delete(sessions.keys().next().value!);
            }
            sessions.set(id,{user:human.id,name:human.display_name,csrf:randomBytes(32).toString('hex'),expires:Date.now()+8*3600000});
            response.setHeader('Set-Cookie',`gameai_review=${id}; Path=/api/track; HttpOnly; SameSite=Strict; Max-Age=28800`);
            reply(response,200,{authenticated:true,name:human.display_name,csrf:sessions.get(id)!.csrf});
            return;
        }
        if (path === '/api/track/review-logout')
        {
            sessions.delete(sessionId);
            response.setHeader('Set-Cookie','gameai_review=; Path=/api/track; HttpOnly; SameSite=Strict; Max-Age=0');
            reply(response,200,{authenticated:false});
            return;
        }
        if (isSubmission)
        {
            reply(response,200,path === '/api/track/agent-runs' ? await agentRunRequest(writer,project,input) : await submitRequirement(writer,project,input));
            return;
        }
        if (path === '/api/track/review-decisions')
        {
            reply(response,200,await reviewRequirement(writer,project,session!.user,input));
            return;
        }
        if (path === '/api/track/review-pm-split')
        {
            await checkPmRuntime();
            const started = await startPmJob(writer,project,session!.user,input);
            // Return immediately; publication is owned by the server and guarded by a durable job.
            if (started.created)
            {
                void dispatchPmJob(writer,project,started).catch(() => console.error('PM 结果状态写入失败，需要核实数据库中的执行记录。'));
            }
            reply(response,started.created ? 202 : 200,{job_id:started.job.id,state:started.job.state,repeated:!started.created});
            return;
        }
        reply(response,404,{error:'接口不存在。'});
    }
    catch (error)
    {
        reply(response,error instanceof ReviewError ? 409 : 503,{error:error instanceof ReviewError ? error.message : '需求服务不可用，请检查服务配置。'});
    }
}
