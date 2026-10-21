import {z} from 'zod';
import {createHash} from 'node:crypto';
import {ReviewError} from './requirements.js';

const inputSchema = z.object({
    request_id:z.uuid(), requirement_key:z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,63}$/),
    version:z.string().regex(/^[a-zA-Z0-9._-]{1,40}$/), prompt:z.string().min(1).max(6*1024*1024),
    draft_approval:z.string().trim().min(1).max(4000),
    source_html:z.string().max(5*1024*1024).optional(), windows_json:z.string().max(5*1024*1024).optional(),
    recovery_authorized:z.literal(true)
}).strict();

export async function designDraftRequest(pool, projectKey, raw)
{
    const c = await pool.connect();
    try
    {
        await c.query('BEGIN');
        const project = (await c.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if (!project) throw new ReviewError('项目不存在。');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[project.id]);
        if (raw.action === 'status' || raw.action === 'cancel')
        {
            if (!z.uuid().safeParse(raw.request_id).success) throw new ReviewError('请求编号无效。');
            if (raw.action === 'cancel')
            {
                await c.query("UPDATE gameai.design_draft_jobs SET state='cancelled',error='用户取消后续执行；原运行进程仍需停止凭据' WHERE project_id=$1 AND request_id=$2 AND state<>'completed' AND submission IS NULL",[project.id,raw.request_id]);
            }
            const row = (await c.query('SELECT * FROM gameai.design_draft_jobs WHERE project_id=$1 AND request_id=$2',[project.id,raw.request_id])).rows[0];
            if (!row) throw new ReviewError('Design 请求不存在。');
            if (raw.action === 'cancel' && row.submission && row.state !== 'completed') throw new ReviewError('已进入文档提交阶段；请查询原请求的提交结果。');
            await c.query('COMMIT');
            return publicJob(row);
        }
        const parsed = inputSchema.safeParse(raw);
        if (!parsed.success) throw new ReviewError('Design 初稿输入不完整；需要已确认初稿依据及有限恢复授权。');
        const input = parsed.data;
        const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const prior = (await c.query('SELECT * FROM gameai.design_draft_jobs WHERE project_id=$1 AND request_id=$2',[project.id,input.request_id])).rows[0];
        if (prior)
        {
            if (prior.input_hash !== hash) throw new ReviewError('同一请求编号不能改变初稿输入。');
            await c.query('COMMIT');
            return publicJob(prior);
        }
        const target = (await c.query("SELECT request_id FROM gameai.design_draft_jobs WHERE project_id=$1 AND input->>'requirement_key'=$2 AND input->>'version'=$3",[project.id,input.requirement_key,input.version])).rows[0];
        if (target) throw new ReviewError('该需求版本已有 Design 请求，请使用原 request_id 查询：'+target.request_id);
        const agent = (await c.query(`SELECT a.id FROM gameai.fixed_agents f JOIN gameai.agents a ON a.id=f.agent_id
            JOIN gameai.workers w ON w.id=a.worker_id WHERE f.project_id=$1 AND f.role_code='Design' AND a.enabled AND w.enabled`,[project.id])).rows[0];
        if (!agent) throw new ReviewError('固定 Design Agent 不可用。');
        const job = (await c.query(`INSERT INTO gameai.design_draft_jobs(project_id,request_id,input_hash,input,design_agent_id)
            VALUES($1,$2,$3,$4,$5) RETURNING *`,[project.id,input.request_id,hash,input,agent.id])).rows[0];
        await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'host','Design 初稿进入可恢复队列',$2)",[project.id,{job_id:job.id,requirement_key:input.requirement_key,version:input.version}]);
        await c.query('COMMIT');
        return publicJob(job);
    }
    catch (error)
    {
        await c.query('ROLLBACK');
        throw error;
    }
    finally
    {
        c.release();
    }
}

export function publicJob(job)
{
    return {job_id:job.id,request_id:job.request_id,state:job.state,attempts:job.attempts,
        remaining_attempts:Math.max(0,3-job.attempts),next_attempt_at:job.next_attempt_at,error:job.error,receipt:job.receipt};
}
