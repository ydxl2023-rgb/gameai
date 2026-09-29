import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { z } from 'zod';
import { ReviewError } from './requirements.js';

const requestSchema = z.object({ version_id:z.uuid(), revision:z.string().regex(/^[0-9a-f]{64}$/), document_hash:z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const text = z.string().trim().min(1).max(12000);
const taskSchema = z.object({
    id:z.string().regex(/^[A-Z][A-Z0-9-]{0,31}$/), title:text.max(200), role:z.enum(['Art','Development']),
    description:text, source_refs:z.array(text.max(200)).min(1).max(30),
    acceptance:z.object({ preconditions:text, steps:text, success:text, failure:text, recovery:text, tests:text }).strict(),
    depends_on:z.array(z.string()).max(100)
}).strict();
const planSchema = z.object({ summary:text, tasks:z.array(taskSchema).min(1).max(100) }).strict();

export function validatePmPlan(raw)
{
    const parsed = planSchema.safeParse(raw);
    if (!parsed.success)
    {
        throw new ReviewError('PM 输出缺少任务角色、正文、来源或完整交付标准。');
    }
    const plan = parsed.data;
    const byId = new Map(plan.tasks.map(t => [t.id,t]));
    if (byId.size !== plan.tasks.length)
    {
        throw new ReviewError('PM 任务编号重复。');
    }
    const visiting = new Set();
    const visited = new Set();
    const ordered = [];
    function visit(task)
    {
        if (visiting.has(task.id))
        {
            throw new ReviewError('PM 任务依赖存在循环。');
        }
        if (visited.has(task.id))
        {
            return;
        }
        visiting.add(task.id);
        if (new Set(task.depends_on).size !== task.depends_on.length)
        {
            throw new ReviewError('PM 任务依赖重复。');
        }
        for (const id of task.depends_on)
        {
            if (!byId.has(id))
            {
                throw new ReviewError('PM 任务引用了不存在的依赖。');
            }
            visit(byId.get(id));
        }
        visiting.delete(task.id);
        visited.add(task.id);
        ordered.push(task);
    }
    plan.tasks.forEach(visit);
    return { ...plan, tasks:ordered };
}

async function transaction(pool, action)
{
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        throw error;
    }
    finally
    {
        client.release();
    }
}

async function approvedDocument(client, projectKey, input)
{
    const version = (await client.query(`SELECT v.*,r.requirement_key,r.title FROM gameai.requirement_versions v
        JOIN gameai.requirements r ON r.id=v.requirement_id JOIN gameai.projects p ON p.id=v.project_id
        WHERE p.project_key=$1 AND v.id=$2`,[projectKey,input.version_id])).rows[0];
    if (!version)
    {
        throw new ReviewError('需求版本不存在。');
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[version.project_id]);
    const approved = await client.query(`SELECT 1 FROM gameai.approvals WHERE version_id=$1 AND decision='approved'
        AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions WHERE requirement_id=$2 AND ordinal>$3)`,[version.id,version.requirement_id,version.ordinal]);
    if (!approved.rowCount || version.content_hash !== input.revision)
    {
        throw new ReviewError('只能拆分最新且已人工批准的需求版本，请刷新页面。');
    }
    const doc = (await client.query(`SELECT a.sha256,a.verified_at,d.bytes FROM gameai.artifact_links l
        JOIN gameai.artifacts a ON a.id=l.artifact_id JOIN gameai.document_contents d ON d.artifact_id=a.id
        WHERE l.requirement_version_id=$1 AND a.media_type='text/html'`,[version.id])).rows[0];
    if (!doc?.verified_at || doc.sha256 !== input.document_hash || createHash('sha256').update(doc.bytes).digest('hex') !== input.document_hash)
    {
        throw new ReviewError('需求原始 HTML 校验失败。');
    }
    return { ...version, html:doc.bytes.toString('utf8') };
}

export async function startPmJob(pool, projectKey, userId, raw)
{
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success)
    {
        throw new ReviewError('需求版本参数无效。');
    }
    const input = parsed.data;
    return transaction(pool, async client =>
    {
        const version = await approvedDocument(client,projectKey,input);
        const permission = await client.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
            JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code WHERE u.id=$1 AND u.enabled AND ur.project_id=$2
            AND rp.permission_code='requirement.approve'`,[userId,version.project_id]);
        if (!permission.rowCount)
        {
            throw new ReviewError('请由具有审批权限的人工账户启动 PM 拆分。');
        }
        const prior = (await client.query('SELECT * FROM gameai.pm_jobs WHERE requirement_version_id=$1',[version.id])).rows[0];
        if (prior && ['running','completed','unknown'].includes(prior.state))
        {
            return { job:prior, created:false };
        }
        if (prior?.attempts >= 3)
        {
            throw new ReviewError('已失败 3 次，请先检查 PM 输出与服务日志。');
        }
        const published = await client.query("SELECT 1 FROM gameai.plan_versions WHERE requirement_version_id=$1 AND state='published'",[version.id]);
        if (published.rowCount)
        {
            throw new ReviewError('此需求版本已有发布计划，不能重复创建任务。');
        }
        const occupied = await client.query("SELECT 1 FROM gameai.pm_jobs WHERE project_id=$1 AND state IN ('running','unknown')",[version.project_id]);
        if (occupied.rowCount)
        {
            throw new ReviewError('固定 PM 正在拆分其他需求或等待核实，请稍后再试。');
        }
        const pm = (await client.query(`SELECT a.id,w.worker_key FROM gameai.fixed_agents f JOIN gameai.agents a ON a.id=f.agent_id
            JOIN gameai.workers w ON w.id=a.worker_id WHERE f.project_id=$1 AND f.role_code='PM' AND a.enabled AND w.enabled`,[version.project_id])).rows[0];
        if (!pm || pm.worker_key.toLowerCase() !== hostname().toLowerCase())
        {
            throw new ReviewError('本阶段需要启用并绑定当前服务器所在工作站的固定 PM Agent。');
        }
        const job = (await client.query(`INSERT INTO gameai.pm_jobs(project_id,requirement_version_id,execution_id,requested_by,revision,document_hash,state)
            VALUES($1,$2,$3,$4,$5,$6,'running') ON CONFLICT(requirement_version_id) DO UPDATE SET
            execution_id=EXCLUDED.execution_id,requested_by=EXCLUDED.requested_by,state='running',attempts=gameai.pm_jobs.attempts+1,
            error='',started_at=now(),expires_at=now()+interval '20 minutes',finished_at=null RETURNING *`,
        [version.project_id,version.id,randomUUID().replaceAll('-',''),userId,input.revision,input.document_hash])).rows[0];
        await client.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'人工启动 PM 拆分',$3)",[version.project_id,'human:'+userId,{job_id:job.id,execution_id:job.execution_id,version_id:version.id}]);
        return { job, created:true, document:version };
    });
}

export async function publishPmPlan(pool, projectKey, job, result)
{
    const plan = validatePmPlan(result.plan);
    return transaction(pool,async client =>
    {
        const version = await approvedDocument(client,projectKey,{version_id:job.requirement_version_id,revision:job.revision,document_hash:job.document_hash});
        const current = (await client.query('SELECT * FROM gameai.pm_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
        if (current.execution_id !== job.execution_id)
        {
            throw new ReviewError('PM 执行已被替换，拒绝旧结果。');
        }
        if (current.state === 'completed')
        {
            return current;
        }
        if (current.state !== 'running' || new Date(current.expires_at).getTime() <= Date.now())
        {
            throw new ReviewError('PM 执行已过期，需要人工核实。');
        }
        const run = await client.query(`SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations c ON c.id=r.conversation_id
            JOIN gameai.fixed_agents f ON f.agent_id=c.agent_id AND f.project_id=c.project_id AND f.role_code=c.role_code
            WHERE r.execution_id=$1 AND r.state='completed' AND c.project_id=$2 AND c.requirement_key=$3 AND c.role_code='PM' AND c.thread_id=$4`,
        [job.execution_id,version.project_id,version.requirement_key,result.thread_id]);
        if (result.execution_id !== job.execution_id || !run.rowCount)
        {
            throw new ReviewError('结果不是该需求固定 PM 的已完成执行。');
        }
        const parent = (await client.query('INSERT INTO gameai.plans(project_id,requirement_id) VALUES($1,$2) RETURNING id',[version.project_id,version.requirement_id])).rows[0];
        const pv = (await client.query("INSERT INTO gameai.plan_versions(project_id,plan_id,requirement_version_id,version,state) VALUES($1,$2,$3,1,'published') RETURNING id",[version.project_id,parent.id,version.id])).rows[0];
        // The database allocates role-prefixed public numbers; model IDs only resolve this proposal's edges.
        const root = (await client.query(`INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code,description,status)
            VALUES($1,$2,$3,'PM',$4,'pending') RETURNING id`,[version.project_id,pv.id,version.title,plan.summary])).rows[0];
        const ids = new Map();
        for (const task of plan.tasks)
        {
            const criteria = Object.entries(task.acceptance).map(([kind,value]) => ({kind,text:value}));
            const row = (await client.query(`INSERT INTO gameai.tasks(project_id,plan_version_id,parent_id,title,role_code,description,source_refs,delivery_criteria,status)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[version.project_id,pv.id,root.id,task.title,task.role,task.description,JSON.stringify(task.source_refs),JSON.stringify(criteria),task.depends_on.length ? 'blocked' : 'pending'])).rows[0];
            ids.set(task.id,row.id);
            for (const dependency of task.depends_on)
            {
                await client.query('INSERT INTO gameai.task_dependencies(project_id,task_id,depends_on_id) VALUES($1,$2,$3)',[version.project_id,row.id,ids.get(dependency)]);
            }
        }
        const completed = (await client.query("UPDATE gameai.pm_jobs SET state='completed',plan_version_id=$2,task_count=$3,finished_at=now() WHERE id=$1 RETURNING *",[job.id,pv.id,plan.tasks.length])).rows[0];
        await client.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'agent:PM','PM 已发布美术与程序子任务',$2)",[version.project_id,{execution_id:job.execution_id,plan_version_id:pv.id,task_count:plan.tasks.length}]);
        return completed;
    });
}

export async function failPmJob(pool, job, error)
{
    // An uncertain live lease must never be made retryable by a process timeout.
    await pool.query(`UPDATE gameai.pm_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM gameai.agent_runs WHERE execution_id=$2 AND state IN ('running','unknown')) THEN 'unknown' ELSE 'failed' END,
        error=$3,finished_at=now() WHERE id=$1 AND execution_id=$2 AND state='running'`,[job.id,job.execution_id,error.slice(0,2000)]);
}
