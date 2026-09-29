import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import { z } from 'zod';
import { ReviewError } from './requirements.js';
import {loadTaskContext,contextBlockReason} from './qa-context.js';
import {validateTaskResult} from './task-results.js';
import {validateQaReport,applyQaReport,finishRepair} from './qa-repairs.js';
import { verifyTaskFiles } from './task-files.js';

const request = z.object({tasks:z.array(z.object({task_id:z.uuid(),revision:z.number().int().nonnegative()}).strict()).min(1).max(100),auto_continue:z.boolean().optional(),retry:z.boolean().optional()}).strict();
export async function dispatchTasks(pool,projectKey,userId,raw,commit=false)
{
    const parsed=request.safeParse(raw);
    if (!parsed.success || new Set(parsed.data.tasks.map(t=>t.task_id)).size!==parsed.data.tasks.length) throw new ReviewError('派发任务参数无效。');
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const project=(await c.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if (!project) throw new ReviewError('项目不存在。');
        // Match graph/approval lock ordering, then serialize capacity with fixed Agent claims.
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[project.id]);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[project.id]);
        const permission=await c.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
            JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code WHERE u.id=$1 AND u.enabled AND ur.project_id=$2 AND rp.permission_code='requirement.approve'`,[userId,project.id]);
        if (!permission.rowCount) throw new ReviewError('请先使用有审批权限的人工账户登录。');
        const rows=[];
        const jobs=[];
        let workspaceReserved=false;
        for (const input of parsed.data.tasks)
        {
            const t=(await c.query(`SELECT t.*,r.requirement_key,v.id version_id FROM gameai.tasks t
                JOIN gameai.plan_versions p ON p.id=t.plan_version_id JOIN gameai.requirement_versions v ON v.id=p.requirement_version_id
                JOIN gameai.requirements r ON r.id=v.requirement_id WHERE t.id=$1 AND t.project_id=$2`,[input.task_id,project.id])).rows[0];
            if (!t) { rows.push({task_id:input.task_id,ready:false,reason:'任务不存在'}); continue; }
            const a=(await c.query(`SELECT a.*,w.worker_key,w.enabled worker_enabled,w.capacity worker_capacity FROM gameai.fixed_agents f
                JOIN gameai.agents a ON a.id=f.agent_id JOIN gameai.workers w ON w.id=a.worker_id WHERE f.project_id=$1 AND f.role_code=$2`,[project.id,t.role_code])).rows[0];
            let reason='';
            if (!t.parent_id || !['Art','Development','QA'].includes(t.role_code)) reason='此入口仅执行美术、程序和 QA 子任务';
            else if (!t.dispatch_allowed) reason='尚未勾选允许派发';
            else if (t.dispatch_revision!==input.revision) reason='勾选状态已改变，请刷新';
            else if (!['pending','blocked'].includes(t.status) && !(parsed.data.retry && t.status==='failed')) reason='任务已派发、结束或需核实';
            if (!reason && parsed.data.retry && t.status==='failed')
            {
                const attempts=(await c.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[t.id])).rows[0].n;
                if (attempts>=3) reason='已达到三次执行上限，需人工处理';
            }
            const approved=await c.query(`SELECT 1 FROM gameai.plan_versions p JOIN gameai.requirement_versions v ON v.id=p.requirement_version_id
                JOIN gameai.approvals a ON a.version_id=v.id AND a.decision='approved' WHERE p.id=$1 AND p.state='published'
                AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions n WHERE n.requirement_id=v.requirement_id AND n.ordinal>v.ordinal)`,[t.plan_version_id]);
            if (!reason && !approved.rowCount) reason='需求未批准或计划版本已过期';
            const context=await loadTaskContext(c,t);
            const dependencies=context.dependencies;
            if (!reason) reason=await contextBlockReason(context,t);
            if (!reason && t.bound_agent_id && t.bound_agent_id!==a?.id) reason='原执行 Agent 不可用，禁止改派其他 Agent';
            if (!reason && (!a?.enabled || !a.worker_enabled || a.worker_key.toLowerCase()!==hostname().toLowerCase())) reason='没有绑定本机的可用固定 Agent';
            if (!reason)
            {
                const grants=await c.query(`SELECT 1 FROM gameai.agent_grants WHERE agent_id=$1 AND permission_code='task.write_assigned'`,[a.id]);
                const skills=await c.query(`SELECT 1 FROM gameai.agent_skills g JOIN gameai.skills s ON s.skill_key=g.skill_key WHERE g.agent_id=$1 AND g.is_primary AND s.enabled AND s.role_code=$2`,[a.id,t.role_code]);
                if (!grants.rowCount || !skills.rowCount) reason='Agent 缺少任务权限或角色主技能';
                const occupied=await c.query(`SELECT 1 FROM gameai.executions e JOIN gameai.agents a ON a.id=e.agent_id WHERE a.worker_id=$1 AND e.state IN ('assigned','running','unknown')
                    UNION ALL SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id WHERE s.worker_id=$1 AND r.state IN ('running','unknown')`,[a.worker_id]);
                if (!reason && (occupied.rowCount || workspaceReserved)) reason='本机工作目录忙碌，等待当前任务结束';
            }
            const doc=(await c.query(`SELECT a.sha256,a.verified_at,d.bytes FROM gameai.artifact_links l JOIN gameai.artifacts a ON a.id=l.artifact_id
                JOIN gameai.document_contents d ON d.artifact_id=a.id WHERE l.requirement_version_id=$1 AND a.media_type='text/html'`,[t.version_id])).rows[0];
            if (!reason && (!doc?.verified_at || createHash('sha256').update(doc.bytes).digest('hex')!==doc.sha256)) reason='批准文档缺失或校验失败';
            const row={task_id:t.id,id:t.task_key,title:t.title,role:t.role_code,agent:a?.agent_key ?? '—',ready:!reason,reason:reason || '可立即派发'};
            rows.push(row);
            if (reason) continue;
            workspaceReserved=true;
            if (!commit) continue;
            const executionId=randomUUID();
            const prompt=JSON.stringify({platform_context:{authoritative:true,validated_at:new Date().toISOString(),requirement_version_id:t.version_id,plan_version_id:t.plan_version_id,approval:'approved',dispatch_allowed:true,executor:'GameCLIServer'},task:t.task_key,title:t.title,description:t.description,criteria:t.delivery_criteria,source_refs:t.source_refs,dependencies,repair:context.repair,retests:context.retests,approved_html:doc.bytes.toString('utf8')});
            const inputHash=createHash('sha256').update(prompt).digest('hex');
            await c.query(`INSERT INTO gameai.executions(id,project_id,task_id,agent_id,state,started_at) VALUES($1,$2,$3,$4,'assigned',clock_timestamp())`,[executionId,project.id,t.id,a.id]);
            await c.query(`INSERT INTO gameai.task_dispatch_jobs(execution_id,project_id,requested_by,requirement_key,input_hash,context) VALUES($1,$2,$3,$4,$5,$6)`,[executionId,project.id,userId,t.requirement_key,inputHash,JSON.stringify(context)]);
            if (context.repair) await c.query("UPDATE gameai.qa_defects SET rounds=rounds+1,updated_at=now() WHERE id=$1",[context.repair.id]);
            await c.query(`UPDATE gameai.tasks SET status='running',progress=0 WHERE id=$1`,[t.id]);
            await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'人工派发专业任务',$3)`,[project.id,'human:'+userId,{task:t.task_key,execution_id:executionId}]);
            if (parsed.data.auto_continue)
            {
                await c.query(`INSERT INTO gameai.plan_dispatch_flows(plan_version_id,project_id,requested_by,state) VALUES($1,$2,$3,'active')
                    ON CONFLICT(plan_version_id) DO UPDATE SET state='active',requested_by=EXCLUDED.requested_by,reason='',updated_at=now()`,[t.plan_version_id,project.id,userId]);
            }
            jobs.push({executionId,projectId:project.id,taskId:t.id,planVersionId:t.plan_version_id,key:t.requirement_key,role:t.role_code,prompt});
        }
        await c.query('COMMIT');
        return {rows,jobs};
    }
    catch(error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
}

export async function finishTaskDispatch(pool,job,result,error)
{
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.projectId]);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[job.projectId]);
        const execution=(await c.query('SELECT * FROM gameai.executions WHERE id=$1 FOR UPDATE',[job.executionId])).rows[0];
        if (!execution || !['assigned','running'].includes(execution.state)) { await c.query('COMMIT'); return; }
        const proof=(await c.query('SELECT * FROM gameai.agent_runs WHERE execution_id=$1',[job.executionId.replaceAll('-','')])).rows[0];
        // A process error cannot prove that its child stopped; unknown capacity remains occupied.
        const lease=(await c.query('SELECT expires_at,context FROM gameai.task_dispatch_jobs WHERE execution_id=$1',[job.executionId])).rows[0];
        const task=(await c.query(`SELECT t.*,v.requirement_id,v.ordinal FROM gameai.tasks t JOIN gameai.plan_versions p ON p.id=t.plan_version_id JOIN gameai.requirement_versions v ON v.id=p.requirement_version_id WHERE t.id=$1`,[job.taskId])).rows[0];
        const current=await c.query(`SELECT 1 FROM gameai.plan_versions p JOIN gameai.approvals a ON a.version_id=p.requirement_version_id AND a.decision='approved' WHERE p.id=$1 AND p.state='published'
            AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions WHERE requirement_id=$2 AND ordinal>$3)`,[task.plan_version_id,task.requirement_id,task.ordinal]);
        const context=await loadTaskContext(c,task);
        // A repair may change its source files. Every other execution consumes an immutable input snapshot.
        if (!context.repair)
        {
            for (const dependency of context.dependencies)
            {
                if (!dependency.accepted || !await verifyTaskFiles(dependency.artifacts)) error='执行期间上游状态或产物改变，停止放行';
            }
        }
        const snapshot=lease?.context;
        if (snapshot?.dependencies && !isDeepStrictEqual(snapshot.dependencies,context.dependencies)) error='执行期间上游交付版本发生改变';
        if (snapshot?.retests && !isDeepStrictEqual(snapshot.retests,context.retests)) error='复测目标已改变';
        let content;
        if (!error)
        {
            try
            {
                content=validateTaskResult(JSON.parse(result.Text),task.role_code);
                if (task.role_code==='QA') validateQaReport(context,content);
            }
            catch(cause) { error=cause.message; }
        }
        if (!current.rowCount || !await verifyTaskFiles(result?.artifacts)) error=error ?? '需求版本或交付文件已失效';
        const success=!error && proof?.state==='completed' && lease && new Date(lease.expires_at)>new Date();
        const unknown=!success && (!proof || ['running','unknown'].includes(proof.state));
        const state=success ? 'succeeded' : unknown ? 'unknown' : 'failed';
        await c.query('UPDATE gameai.executions SET state=$2,result=$3,ended_at=now() WHERE id=$1',[job.executionId,state,{result,artifacts:result?.artifacts ?? [],error:error ?? (success ? '' : '缺少完成凭据，需核实执行')}]);
        const flow=(await c.query('SELECT state FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[task.plan_version_id])).rows[0];
        const completed=success && !context.repair && flow?.state==='active' && ['Art','Development'].includes(task.role_code);
        await c.query('UPDATE gameai.tasks SET status=$2,progress=$3 WHERE id=$1',[job.taskId,success ? completed ? 'completed' : 'review' : unknown ? 'running' : 'failed',success ? 100 : 0]);
        if (success && context.repair) await finishRepair(c,task,context.repair);
        if (success && task.role_code==='QA') await applyQaReport(c,task,execution,context,content);
        if (!success) await c.query("UPDATE gameai.plan_dispatch_flows SET state='paused',reason=$2,updated_at=now() WHERE plan_version_id=$1",[task.plan_version_id,error ?? '执行状态待核实']);
        let summary=error ?? '执行状态待核实';
        if (!error && result?.Text)
        {
            const content=JSON.parse(result.Text);
            summary=content.summary+'\n交付文件：\n'+(content.files ?? []).join('\n')+'\n检查：\n'+(content.checks ?? []).map(check=>`${check.name}：${check.passed ? '通过' : '未通过'}（${check.evidence_path}）`).join('\n');
        }
        await c.query(`INSERT INTO gameai.comments(project_id,task_id,execution_id,body) VALUES($1,$2,$3,$4)`,[job.projectId,job.taskId,job.executionId,
            `${success && task.role_code==='QA' && content.verdict==='fail' ? 'QA 发现缺陷，已建立返修任务' : completed ? '工程交付校验通过' : success ? '执行完成，等待验收' : '执行未通过'}\n${summary}`]);
        await c.query(`UPDATE gameai.tasks parent SET progress=summary.progress,status=CASE WHEN summary.finished THEN 'review' ELSE 'running' END
            FROM (SELECT parent_id,round(100.0*count(*) FILTER(WHERE status IN ('completed','review'))/count(*))::int progress,bool_and(status IN ('completed','review')) finished
                FROM gameai.tasks WHERE parent_id=$1 GROUP BY parent_id) summary WHERE parent.id=summary.parent_id`,[task.parent_id]);
        await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator',$2,$3)`,[job.projectId,success ? completed ? '工程交付校验通过，通知后续任务' : '任务执行结束，等待人工验收' : '任务执行失败或待核实',{task_id:job.taskId,execution_id:job.executionId,state,summary:content?.summary,error:error ?? null}]);
        await c.query('COMMIT');
        return {success,completed};
    }
    catch(error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
}
