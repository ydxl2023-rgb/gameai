import {artVisualScope} from './ui-visual-delivery.js';
import {buildProductionSkeleton,validateDesignDocument} from './design-contract.js';
import {readApprovedContract,stages} from './ui-production-contract.js';
import {registerContract,submitTaskPlan} from './ui-task-plans.js';
import {storePrefabTaskHtml} from './prefab-task-document.js';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { z } from 'zod';
import { ReviewError } from './requirements.js';
import { validateUiDeliveryPlan } from './ui-delivery-plan.js';

const requestSchema = z.object({ version_id:z.uuid(), revision:z.string().regex(/^[0-9a-f]{64}$/), document_hash:z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const text = z.string().trim().min(1).max(12000);
const taskSchema = z.object({
    id:z.string().regex(/^[A-Z][A-Z0-9-]{0,31}$/), title:text.max(200), role:z.enum(['Prefab','Art','Development','QA']),
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
    if (plan.tasks.some(t=>t.role==='QA' && !t.depends_on.some(id=>['Development','Prefab'].includes(byId.get(id)?.role)))) throw new ReviewError('QA 必须依赖具体程序或预制交付任务。');
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
        validateDesignDocument(version.html,{projectId:version.project_id,versionId:version.id});
        buildProductionSkeleton(version.html,version.version);
        const permission = await client.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
            JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code WHERE u.id=$1 AND u.enabled AND ur.project_id=$2
            AND rp.permission_code='requirement.approve'`,[userId,version.project_id]);
        if (!permission.rowCount)
        {
            throw new ReviewError('请由具有审批权限的人工账户启动 PM 拆分。');
        }
        const prior = (await client.query('SELECT * FROM gameai.pm_jobs WHERE requirement_version_id=$1',[version.id])).rows[0];
        if (prior && ['running','completed','unknown','revision_required'].includes(prior.state))
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

export async function publishPmPlan(pool, projectKey, job, result, {recoverPublication=false} = {})
{
    const proposal = validatePmPlan(result.plan);
    return transaction(pool,async client =>
    {
        const version = await approvedDocument(client,projectKey,{version_id:job.requirement_version_id,revision:job.revision,document_hash:job.document_hash});
        validateDesignDocument(version.html,{projectId:version.project_id,versionId:version.id});
        // Reconstruct from authoritative bytes inside the publication transaction, never trust a caller's scope.
        const skeleton = buildProductionSkeleton(version.html,version.version);
        const plan = validateUiDeliveryPlan(proposal,skeleton);
        const current = (await client.query('SELECT * FROM gameai.pm_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
        if (current.execution_id !== job.execution_id)
        {
            throw new ReviewError('PM 执行已被替换，拒绝旧结果。');
        }
        if (current.state === 'completed')
        {
            if (recoverPublication)
            {
                await restorePublicationFlow(client,version,current.plan_version_id,true);
            }
            return current;
        }
        // A completed fixed-Agent result can outlive its execution lease after a publication failure.
        // Recovery still checks the latest approval, exact execution identity and completed Agent proof below.
        const recovering = recoverPublication && current.state === 'failed';
        if (!recovering && (current.state !== 'running' || new Date(current.expires_at).getTime() <= Date.now()))
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
        const pmStages=(await client.query('SELECT stage,state FROM gameai.pm_stages WHERE parent_execution_id=$1',[job.execution_id])).rows;
        if (pmStages.length && (pmStages.length!==4 || pmStages.some(s=>s.state!=='completed')))
        {
            throw new ReviewError('专业 PM 阶段尚未全部完成，禁止发布部分计划。');
        }
        const parent = (await client.query('INSERT INTO gameai.plans(project_id,requirement_id) VALUES($1,$2) RETURNING id',[version.project_id,version.requirement_id])).rows[0];
        const pv = (await client.query("INSERT INTO gameai.plan_versions(project_id,plan_id,requirement_version_id,version,state) VALUES($1,$2,$3,1,'published') RETURNING id",[version.project_id,parent.id,version.id])).rows[0];
        // The database allocates role-prefixed public numbers; model IDs only resolve this proposal's edges.
        const root = (await client.query(`INSERT INTO gameai.tasks(project_id,plan_version_id,title,role_code,description,status)
            VALUES($1,$2,$3,'PM',$4,'pending') RETURNING id`,[version.project_id,pv.id,version.title,plan.summary])).rows[0];
        // Freeze the approved contract and create all phase tasks in this same transaction.
        const contract=readApprovedContract(version.html);
        const registered=await registerContract(pool,contract,job.requested_by,client);
        const contractPlan={schemaVersion:'ui-task-plan/1',requestId:job.id,projectId:version.project_id,
            requirementVersionId:version.id,parentTaskId:root.id,contract:registered,
            windows:contract.windows.map(w=>({windowId:w.windowId,stages}))};
        delete contractPlan.contract.created;
        const published=await submitTaskPlan(pool,contractPlan,job.requested_by,true,client);
        if (published.tasks.length!==plan.tasks.length) throw new ReviewError('PM scope differs from approved production contract');
        for (const created of published.tasks)
        {
            const stored=(await client.query('SELECT * FROM gameai.tasks WHERE id=$1',[created.id])).rows[0];
            const task=plan.tasks.find(t=>t.id===stored.logical_id);
            if (!task) throw new ReviewError('PM task identity differs from production contract');
            if (stored.role_code==='Art') task.description+='\n视觉资产交付职责：'+artVisualScope;
            await client.query('UPDATE gameai.tasks SET title=$2,description=$3,source_refs=$4 WHERE id=$1',
                [stored.id,task.title,task.description,JSON.stringify(task.source_refs)]);
            await storePrefabTaskHtml(client,{...stored,title:task.title,description:task.description,source_refs:task.source_refs},version.html,job.document_hash);
        }
        const qaTasks = [];
        await restorePublicationFlow(client,version,pv.id,recovering);
        const taskCount=plan.tasks.length+qaTasks.length;
        const completed = (await client.query("UPDATE gameai.pm_jobs SET state='completed',error='',plan_version_id=$2,task_count=$3,finished_at=now() WHERE id=$1 RETURNING *",[job.id,pv.id,taskCount])).rows[0];
        await client.query(`INSERT INTO gameai.workflow_outbox(event_key,plan_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,['pm:'+job.execution_id,pv.id]);
        await client.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'agent:PM','PM 已发布 UI 白模、美术资源与装配任务',$2)",[version.project_id,{execution_id:job.execution_id,plan_version_id:pv.id,task_count:taskCount}]);
        return completed;
    });
}

async function restorePublicationFlow(client,version,planVersionId,recovering)
{
        // Recover only the persisted approval workflow and its original role policy.
        const automatic=(await client.query("SELECT * FROM gameai.approval_workflows WHERE version_id=$1 AND (state IN ('pm','manual_pm') OR ($2 AND state='failed')) FOR UPDATE",[version.id,recovering])).rows[0];
        if (automatic)
        {
            // Only the immutable human approval authorizes selecting this exact plan's children.
            await client.query(`UPDATE gameai.tasks SET dispatch_allowed=true,dispatch_revision=dispatch_revision+1,dispatch_selected_by=$2,dispatch_selected_at=now() WHERE plan_version_id=$1 AND parent_id IS NOT NULL AND NOT dispatch_allowed AND ($3::jsonb IS NULL OR role_code IN (SELECT value->>'role_code' FROM jsonb_array_elements($3::jsonb)))`,[planVersionId,automatic.requested_by,automatic.agent_policy===null?null:JSON.stringify(automatic.agent_policy)]);
            await client.query("INSERT INTO gameai.plan_dispatch_flows(plan_version_id,project_id,requested_by,state,agent_policy) VALUES($1,$2,$3,'active',$4) ON CONFLICT(plan_version_id) DO NOTHING",[planVersionId,version.project_id,automatic.requested_by,automatic.agent_policy===null?null:JSON.stringify(automatic.agent_policy)]);
            await client.query("UPDATE gameai.approval_workflows SET state='dispatched',error='',updated_at=now() WHERE version_id=$1",[version.id]);
        }
}

export async function failPmJob(pool, job, error)
{
    // An uncertain live lease must never be made retryable by a process timeout.
    await pool.query(`WITH failed AS (UPDATE gameai.pm_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM gameai.agent_runs WHERE (execution_id=$2 OR execution_id IN (SELECT execution_id FROM gameai.pm_stages WHERE parent_execution_id=$2)) AND state IN ('running','unknown')) THEN 'unknown' ELSE 'failed' END,
        error=$3,finished_at=now() WHERE id=$1 AND execution_id=$2 AND state='running' RETURNING *)
        INSERT INTO gameai.audit_events(project_id,actor,event,payload)
        SELECT project_id,'agent:PM','PM 拆分失败或待核实',jsonb_build_object('execution_id',execution_id,'version_id',requirement_version_id,'state',state,'error',error) FROM failed`,[job.id,job.execution_id,error.slice(0,2000)]);
}
