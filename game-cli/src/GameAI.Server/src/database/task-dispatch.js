import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import { z } from 'zod';
import { ReviewError } from './requirements.js';
import {loadTaskContext,contextBlockReason} from './qa-context.js';
import {validateTaskResult} from './task-results.js';
import {validateQaReport,applyQaReport,finishRepair} from './qa-repairs.js';
import { verifyTaskFiles } from './task-files.js';
import {validateVisualDelivery,artVisualScope} from './ui-visual-delivery.js';
import { prepareApprovedDocument } from './approved-document.js';
import {snapshotPrefabInputs} from './delivery-snapshot.js';
import {readTaskInput} from './ui-task-plans.js';
import {recoveryDecision,recoveryAttempts} from './task-recovery.js';
import {prepareUiDocumentPrompt} from './ui-document-prompt.js';
import {loadSkillInstructions} from './skill-catalog.js';
import {hasPublicationProof} from './publication-proof.js';
import {readRequirementRules} from './requirement-rules.js';
import {deliveryFailure} from './delivery-errors.js';
import {registerContractAssets} from './delivery-registration.js';
import {enqueueTaskRepair,repairScopeHash} from './task-repairs.js';
import {finishUpstreamRepair} from './upstream-repairs.js';
import {resourceNamingPlan} from './ui-asset-naming.js';
import {loadAssetAliases} from './asset-path-aliases.js';
import {projectRoot} from '../paths.js';

const request = z.object({tasks:z.array(z.object({task_id:z.uuid(),revision:z.number().int().nonnegative()}).strict()).min(1).max(100),auto_continue:z.boolean().optional(),recovery_cycle:z.boolean().optional(),retry:z.boolean().optional(),retry_override:z.object({attempts:z.number().int().min(3),reason:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();

export function retryLimitReason(attempts, override, automaticDispatch)
{
    if (override && (automaticDispatch || override.attempts !== attempts)) return '人工重试授权已过期或用于自动派发，请重新核实执行次数';
    return attempts >= 3 && !override ? '已达到三次执行上限，需人工处理' : '';
}
export async function dispatchTasks(pool,projectKey,userId,raw,commit=false,automaticDispatch=false)
{
    const parsed=request.safeParse(raw);
    if (!parsed.success || new Set(parsed.data.tasks.map(t=>t.task_id)).size!==parsed.data.tasks.length) throw new ReviewError('派发任务参数无效。');
    if (parsed.data.retry_override && (automaticDispatch || !parsed.data.retry || parsed.data.tasks.length!==1 || parsed.data.auto_continue)) throw new ReviewError('超限重试仅允许人工对单个失败任务授权一次。');
    if (parsed.data.recovery_cycle && (automaticDispatch || !parsed.data.retry || parsed.data.tasks.length!==1)) throw new ReviewError('修复轮次只能由人工针对单个任务重新开启。');
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
            let automaticBudget=null;
            const previous=parsed.data.retry ? (await c.query('SELECT e.agent_id,e.state,e.result,j.context FROM gameai.executions e LEFT JOIN gameai.task_dispatch_jobs j ON j.execution_id=e.id WHERE e.task_id=$1 ORDER BY e.started_at DESC LIMIT 1',[t.id])).rows[0] : null;
            if (previous && previous.agent_id!==a?.id) reason='原执行 Agent 不可用，禁止改派其他 Agent';
            if (parsed.data.retry_override && t.status!=='failed') throw new ReviewError('超限重试只适用于失败任务。');
            if (parsed.data.recovery_cycle && t.status!=='failed') throw new ReviewError('新的修复轮次只适用于已确认失败的任务。');
            if (!t.parent_id || !['Prefab','Art','Development','QA'].includes(t.role_code)) reason='此入口仅执行预制、美术、程序和 QA 子任务';
            else if (!t.dispatch_allowed) reason='尚未勾选允许派发';
            else if (t.dispatch_revision!==input.revision) reason='勾选状态已改变，请刷新';
            else if (!['pending','blocked'].includes(t.status) && !(parsed.data.retry && t.status==='failed')) reason='任务已派发、结束或需核实';
            if (!reason && parsed.data.retry && t.status==='failed')
            {
                const attempts=(await c.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[t.id])).rows[0].n;
                if (automaticDispatch)
                {
                    const receipt=(await c.query(`SELECT evidence FROM gameai.task_repairs WHERE task_id=$1 AND state='ready' ORDER BY updated_at DESC LIMIT 1`,[t.id])).rows[0];
                    const budget=receipt?.evidence?.budget;
                    if (budget?.validated && budget.handlerFingerprint===receipt.evidence.receipt?.handlerFingerprint) automaticBudget=budget;
                }
                const retryContext=automaticBudget ? {...previous?.context,verified_repair_budget:automaticBudget} : previous?.context;
                reason=retryLimitReason(automaticDispatch ? recoveryAttempts(attempts,retryContext) : attempts,parsed.data.retry_override,automaticDispatch);
                if (!reason && automaticDispatch)
                {
                    const repair=(await c.query('SELECT state FROM gameai.task_repairs WHERE execution_id=(SELECT id FROM gameai.executions WHERE task_id=$1 ORDER BY started_at DESC LIMIT 1)',[t.id])).rows[0];
                    if (repair ? repair.state!=='ready' : !recoveryDecision({state:previous?.state,error:previous?.result?.error,failure:previous?.result?.failure,attempts:recoveryAttempts(attempts,previous?.context),authorized:true}).retry) reason='失败正在诊断、修复或等待恢复条件，不允许原样重试';
                }
            }
            const approved=await c.query(`SELECT 1 FROM gameai.plan_versions p JOIN gameai.requirement_versions v ON v.id=p.requirement_version_id
                JOIN gameai.approvals a ON a.version_id=v.id AND a.decision='approved' WHERE p.id=$1 AND p.state='published'
                AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions n WHERE n.requirement_id=v.requirement_id AND n.ordinal>v.ordinal)`,[t.plan_version_id]);
            if (!reason && !approved.rowCount) reason='需求未批准或计划版本已过期';
            let context=await loadTaskContext(c,t);
            const upstreamRepairs=(await c.query("SELECT * FROM gameai.upstream_repairs WHERE source_task_id=$1 AND state='open' ORDER BY created_at",[t.id])).rows;
            if (!reason && automaticDispatch && upstreamRepairs.length)
            {
                const attempts=(await c.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[t.id])).rows[0].n;
                if (attempts>=3) reason='原上游任务修复预算已用尽，需要可验证的新修复方案';
            }
            let dependencies=context.dependencies;
            if (!reason) reason=await contextBlockReason(context,t);
            if (!reason && automaticDispatch)
            {
                const flow=(await c.query('SELECT agent_policy FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[t.plan_version_id])).rows[0];
                // A plan-level continuation flag never overrides the current Agent automation permission.
                if(!flow || !a?.auto_execute || (flow.agent_policy && !flow.agent_policy.some(entry=>entry.id===a.id && entry.role_code===t.role_code))) reason='对应 Agent 未授权自动执行，等待人工派发';
            }
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
            // Reject stale instructions before reserving an execution. A pre-claim failure
            // must not leave an unknown execution that blocks catalog repair forever.
            try
            {
                const selected=(await c.query('SELECT s.* FROM gameai.agent_skills g JOIN gameai.skills s ON s.skill_key=g.skill_key WHERE g.agent_id=$1',[a.id])).rows;
                const catalog=(await c.query('SELECT * FROM gameai.skills')).rows;
                if (!await readRequirementRules(c,t.version_id,t.role_code)) await loadSkillInstructions(selected,catalog,undefined,t.role_code);
            }
            catch (error)
            {
                row.ready=false;
                row.reason=error.message;
                continue;
            }
            workspaceReserved=true;
            if (!commit) continue;
            await snapshotPrefabInputs(c,t);
            context=await loadTaskContext(c,t);
            dependencies=context.dependencies;
            if (parsed.data.recovery_cycle)
            {
                const priorAttempts=(await c.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[t.id])).rows[0].n;
                context.recovery_cycle={id:randomUUID(),prior_attempts:priorAttempts,requested_by:userId};
                await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'人工开启有限自动修复轮次',$3)`,[project.id,'human:'+userId,{task:t.task_key,...context.recovery_cycle,max_attempts:3}]);
            }
            else if (automaticDispatch && previous?.context?.recovery_cycle)
            {
                context.recovery_cycle=previous.context.recovery_cycle;
            }
            if (automaticDispatch && (automaticBudget || previous?.context?.verified_repair_budget))
            {
                context.verified_repair_budget=automaticBudget ?? previous.context.verified_repair_budget;
            }
            const executionId=randomUUID();
            if (previous && automaticDispatch)
            {
                await c.query(`UPDATE gameai.task_repairs SET state='dispatched',updated_at=now() WHERE task_id=$1 AND state='ready'`,[t.id]);
            }
            // Exact prior attempt count makes this human exception single-use under the project lock.
            // Failed history is retained and automatic dispatch never receives this exception.
            if (parsed.data.retry_override)
            {
                await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,$3,$4)`,[project.id,'human:'+userId,'人工授权单次超限重试',{task:t.task_key,execution_id:executionId,prior_attempts:parsed.data.retry_override.attempts,reason:parsed.data.retry_override.reason}]);
            }
            const approvedDocument=await prepareApprovedDocument(t.version_id,doc.sha256,doc.bytes.toString('utf8'));
            const taskDoc = t.role_code === 'Prefab' ? (await c.query(`SELECT a.storage_key,a.sha256,d.bytes FROM gameai.artifact_links l
                JOIN gameai.artifacts a ON a.id=l.artifact_id JOIN gameai.document_contents d ON d.artifact_id=a.id
                WHERE l.task_id=$1 AND a.storage_key LIKE 'deliveries/%/task-%.html' ORDER BY a.verified_at DESC LIMIT 1`,[t.id])).rows[0] : null;
            if (taskDoc && createHash('sha256').update(taskDoc.bytes).digest('hex') !== taskDoc.sha256) throw new ReviewError('预制任务 HTML 校验失败。');
            const humanNotes=(await c.query('SELECT body,created_at FROM gameai.comments WHERE task_id=$1 AND user_id IS NOT NULL ORDER BY created_at DESC LIMIT 10',[t.id])).rows;
            for (const request of upstreamRepairs)
            {
                humanNotes.unshift({body:'服务端核验的下游返修交接：'+JSON.stringify(request)+
                    '\n沿用本任务原冻结契约、交付路径和原验收；先复现证据，只修复职责范围内的问题，必须重新通过本任务完整验收。不得自行改需求、审批或替代下游验收。',created_at:request.created_at});
            }
            const feedback=previous ? (await c.query(`SELECT id::text,event,body,role,created_at FROM gameai.collaboration_messages
                WHERE project_id=$1 AND task_id=$2 ORDER BY id DESC LIMIT 8`,[project.id,t.id])).rows.reverse() : [];
            const repairContext=previous ? (await c.query('SELECT code,decision,evidence FROM gameai.task_repairs WHERE execution_id=(SELECT id FROM gameai.executions WHERE task_id=$1 ORDER BY started_at DESC LIMIT 1)',[t.id])).rows[0] : null;
            if (automaticDispatch && (repairContext?.evidence?.receipt?.handlerFingerprint || previous?.context?.repair_handler_fingerprint))
            {
                context.repair_handler_fingerprint=repairContext?.evidence?.receipt?.handlerFingerprint ?? previous.context.repair_handler_fingerprint;
            }
            const failureContext=previous ? {error:previous.result?.error,failure:previous.result?.failure,repair:repairContext,previous_result:previous.result?.result?.Text ?? null,collaboration_feedback:feedback,instruction:'先复现上次失败并读取已有产物、检查证据和宿主修复记录。输入和产物哈希未变的已通过步骤可以复用；重跑失败步骤及受修复影响的检查，保留最终完整验收。必须提供根因、实际修改和验证证据，不能原样反复重跑。不得覆盖冻结契约、审批、权限或降低验收标准。'} : null;
            const productionContract=await readTaskInput(c,t.id);
            if (['Prefab','Art'].includes(t.role_code) && !productionContract) throw new ReviewError('UI task requires a frozen production contract; recreate through contract task submission.');
            if (productionContract) productionContract.path=`game-cli/temp/task-jobs/${executionId}/production-input.json`;
            if (productionContract)
            {
                const assetAliases=await loadAssetAliases(projectRoot);
                humanNotes.unshift({body:JSON.stringify({assetNaming:{schemaVersion:'ui-asset-naming/1',resources:resourceNamingPlan(productionContract.content.window,assetAliases),migrations:assetAliases,
                    rules:'新项目资源文件用简短用途名（例如 RepairIcon.png）；字体采用可识别的字体族与字重名（例如 MicrosoftYaHeiRegular.ttc），保留原字体格式，不以完整哈希或文本节点名命名字体，完整SHA256只放清单和内部blob缓存；重名加稳定短后缀。已有迁移资源必须使用登记的新路径，禁止重建旧哈希文件。旧冻结契约/快照仍保留原路径原文，由Unity桥接按登记的内容哈希和GUID解析迁移；不改写批准JSON或历史交付。沿用旧审批时 resource-snapshot.json 保留原逻辑路径以通过原 guard，实际导出快照可另存；只有新需求的目标快照使用实际新路径。'}}),created_at:new Date().toISOString()});
            }
            if (productionContract?.content.taskAmendments?.length)
            {
                humanNotes.unshift({body:'本轮 production_contract 已由服务组合原冻结输入与人工授权的 taskAmendments；其 window 是增补后的唯一制作目标。增补项仅覆盖明确列出的旧属性约束，不修改旧 HTML 或审批历史。读取 taskAmendments.evidenceDirectory 中已修复资产、guard 和证据，优先复核并交付，禁止用旧 assembly 覆盖现有修复。按 simulation 配置进行四态模拟验收，不声称真机通过。',created_at:new Date().toISOString()});
            }
            if (productionContract?.content.type==='prefab-assembly')
            {
                humanNotes.unshift({body:`宿主在启动本次Agent前将完成真实正式装配预检，并保存 game-cli/temp/task-jobs/${executionId}/execution-preflight.json。读取该凭据；applicable=true 时使用其中 assemblyPath 指向的已双侧核验封装进行正式装配，不从历史35项清单重新派生参数。资源投影只允许保留原批准条目和全部实际绑定，源、目标及批准原文哈希保持不变；不得删改批准目标或以whitebox模式代替最终装配。原节点、组件、最终九项验收仍全部执行。`,created_at:new Date().toISOString()});
            }
            const prompt=JSON.stringify({production_contract:productionContract,stage_responsibility:t.role_code==='Art' ? artVisualScope : t.role_code==='Prefab' ? 'Prefab 只负责 production_contract 中指定的白模或最终装配阶段；白模按冻结目标建立结构与占位，最终装配消费已验收 Art 资产并执行原完整验收，不代做美术资产。' : null,failure_context:failureContext,human_task_notes:humanNotes,task_document:taskDoc ? {path:taskDoc.storage_key,sha256:taskDoc.sha256,content_source:'完整窗口原文和附件可从 approved_document 路径按 source_refs 读取；独立 HTML 原件也可通过本路径读取。'} : null,approved_document:approvedDocument,platform_context:{authoritative:true,validated_at:new Date().toISOString(),requirement_version_id:t.version_id,plan_version_id:t.plan_version_id,approval:'approved',dispatch_allowed:true,executor:'GameCLIServer',human_retry_context:parsed.data.retry_override ? {actor:'human:'+userId,reason:parsed.data.retry_override.reason,prior_attempts:parsed.data.retry_override.attempts} : null},task:t.task_key,title:t.title,description:t.description,criteria:t.delivery_criteria,source_refs:t.source_refs,dependencies,repair:context.repair,retests:context.retests,approved_html:prepareUiDocumentPrompt(doc.bytes.toString('utf8'),approvedDocument)});
            const inputHash=createHash('sha256').update(prompt).digest('hex');
            await c.query(`INSERT INTO gameai.executions(id,project_id,task_id,agent_id,state,started_at) VALUES($1,$2,$3,$4,'assigned',clock_timestamp())`,[executionId,project.id,t.id,a.id]);
            await c.query(`INSERT INTO gameai.task_dispatch_jobs(execution_id,project_id,requested_by,requirement_key,input_hash,context) VALUES($1,$2,$3,$4,$5,$6)`,[executionId,project.id,userId,t.requirement_key,inputHash,JSON.stringify(context)]);
            if (context.repair) await c.query("UPDATE gameai.qa_defects SET rounds=rounds+1,updated_at=now() WHERE id=$1",[context.repair.id]);
            await c.query(`UPDATE gameai.tasks SET status='running',progress=0 WHERE id=$1`,[t.id]);
            await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,$4,$3)`,[project.id,'human:'+userId,{task:t.task_key,execution_id:executionId},automaticDispatch?'编排器自动派发专业任务':'人工派发专业任务']);
            if (parsed.data.auto_continue)
            {
                await c.query(`INSERT INTO gameai.plan_dispatch_flows(plan_version_id,project_id,requested_by,state) VALUES($1,$2,$3,'active')
                    ON CONFLICT(plan_version_id) DO UPDATE SET state='active',requested_by=EXCLUDED.requested_by,agent_policy=NULL,reason='',updated_at=now()`,[t.plan_version_id,project.id,userId]);
            }
            const job={executionId,projectId:project.id,taskId:t.id,planVersionId:t.plan_version_id,key:t.requirement_key,role:t.role_code,prompt};
            await c.query('INSERT INTO gameai.task_publications(execution_id,job) VALUES($1,$2)',[executionId,job]);
            jobs.push(job);
        }
        await c.query('COMMIT');
        return {rows,jobs};
    }
    catch(error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
}

export async function finishTaskDispatch(pool,job,result,error,{recoverPublication=false,failure=null}={})
{
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.projectId]);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[job.projectId]);
        const execution=(await c.query('SELECT * FROM gameai.executions WHERE id=$1 FOR UPDATE',[job.executionId])).rows[0];
        const proof=(await c.query('SELECT * FROM gameai.agent_runs WHERE execution_id=$1',[job.executionId.replaceAll('-','')])).rows[0];
        const reconciled=execution?.state==='unknown' && ['completed','failed'].includes(proof?.state);
        if (!execution || (!['assigned','running'].includes(execution.state) && !reconciled)) { await c.query('COMMIT'); return; }
        // A process error cannot prove that its child stopped; unknown capacity remains occupied.
        const lease=(await c.query('SELECT expires_at,context,input_hash FROM gameai.task_dispatch_jobs WHERE execution_id=$1',[job.executionId])).rows[0];
        if (result && result.InputSha256!==lease?.input_hash) error='执行输入哈希不匹配';
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
                const frozen=await readTaskInput(c,task.id);
                // Assembly may consume verified upstream assets without duplicating them in its own report.
                const visualArtifacts=frozen?.content.type==='prefab-assembly'
                    ? [...(result.artifacts ?? []),...context.dependencies.flatMap(d=>d.artifacts ?? [])]
                    : result.artifacts;
                const registered=await registerContractAssets(frozen?.content,visualArtifacts ?? []);
                const added=registered.slice(visualArtifacts?.length ?? 0);
                if (added.length)
                {
                    result.artifacts=[...(result.artifacts ?? []),...added];
                    await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','契约交付资产核验并补登记',$2)`,[job.projectId,{task_id:job.taskId,execution_id:job.executionId,artifacts:added,summary:`已按冻结契约核验并补登记 ${added.length} 个资产；当前执行记录与实际文件哈希一致。`}]);
                }
                validateVisualDelivery(frozen?.content,registered);
            }
            catch(cause) { error=cause.message; failure=deliveryFailure(cause); }
        }
        if (!current.rowCount || !await verifyTaskFiles(result?.artifacts)) error=error ?? '需求版本或交付文件已失效';
        // Late publication is allowed only when the same Agent actually completed within its lease.
        const success=!error && hasPublicationProof(proof,lease,recoverPublication);
        const stoppedBeforeClaim=!proof && failure?.pre_execution===true;
        const unknown=!success && !stoppedBeforeClaim && (!proof || ['running','unknown'].includes(proof.state));
        const state=success ? 'succeeded' : unknown ? 'unknown' : 'failed';
        await c.query('UPDATE gameai.executions SET state=$2,result=$3,ended_at=now() WHERE id=$1',[job.executionId,state,{result,artifacts:result?.artifacts ?? [],failure,error:error ?? (success ? '' : '缺少完成凭据，需核实执行')}]);
        const flow=(await c.query('SELECT state,reason FROM gameai.plan_dispatch_flows WHERE plan_version_id=$1',[task.plan_version_id])).rows[0];
        const recoveringConfirmedStop=reconciled && flow?.state==='paused' && (flow.reason===execution.result?.recovery?.reason || flow.reason==='自动恢复处理中：'+execution.result?.recovery?.reason);
        if (success && recoveringConfirmedStop && (await c.query('SELECT 1 FROM gameai.agents WHERE id=$1 AND auto_execute AND enabled',[execution.agent_id])).rowCount)
        {
            await c.query("UPDATE gameai.plan_dispatch_flows SET state='active',reason='已核实原执行停止并恢复原结果',updated_at=now() WHERE plan_version_id=$1",[task.plan_version_id]);
            flow.state='active';
        }
        const completed=success && !context.repair && flow?.state==='active' && ['Prefab','Art','Development'].includes(task.role_code);
        await c.query('UPDATE gameai.tasks SET status=$2,progress=$3 WHERE id=$1',[job.taskId,success ? completed ? 'completed' : 'review' : unknown ? 'running' : 'failed',success ? 100 : 0]);
        if (success && context.repair) await finishRepair(c,task,context.repair);
        if (success && (completed || (task.role_code==='QA' && content.verdict==='pass'))) await finishUpstreamRepair(c,task,job.executionId);
        if (success) await c.query(`UPDATE gameai.task_repairs SET state='resolved',updated_at=now() WHERE task_id=$1 AND state NOT IN ('resolved','cancelled')`,[task.id]);
        if (success && task.role_code==='QA') await applyQaReport(c,task,execution,context,content);
        if (!success)
        {
            const attempts=(await c.query('SELECT count(*)::int n FROM gameai.executions WHERE task_id=$1',[task.id])).rows[0].n;
            const agent=(await c.query('SELECT auto_execute FROM gameai.agents WHERE id=$1',[execution.agent_id])).rows[0];
            const recovery=recoveryDecision({state,error,failure,attempts:recoveryAttempts(attempts,lease?.context),authorized:(flow?.state==='active' || recoveringConfirmedStop) && agent?.auto_execute});
            const repairInput=repairScopeHash(task,lease?.context,(await readTaskInput(c,task.id))?.sha256);
            const queued=await enqueueTaskRepair(c,task,job.executionId,recovery,{error,failure,context:{...lease?.context,input_hash:lease?.input_hash,repair_input_hash:repairInput},result});
            await c.query(`UPDATE gameai.executions SET result=jsonb_set(result,'{recovery}',$2::jsonb) WHERE id=$1`,[job.executionId,JSON.stringify({...queued.decision,repair_state:queued.state})]);
            await c.query("UPDATE gameai.plan_dispatch_flows SET state='paused',reason=$2,updated_at=now() WHERE plan_version_id=$1",[task.plan_version_id,queued.state==='pending' ? '自动恢复处理中：'+queued.decision.reason : queued.decision.reason]);
            await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator',$2,$3)`,[job.projectId,queued.state==='pending'?'任务失败，已进入自动诊断修复':'任务自动修复需要处理',{task_id:job.taskId,execution_id:job.executionId,reason:queued.decision.reason,error,failure,attempts}]);
        }
        let summary=error ?? '执行状态待核实';
        if (!error && result?.Text)
        {
            const content=JSON.parse(result.Text);
            summary=content.summary+'\n交付文件：\n'+(content.files ?? []).join('\n')+'\n检查：\n'+(content.checks ?? []).map(check=>`${check.name}：${check.passed ? '通过' : '未通过'}（${check.evidence_path}）`).join('\n');
        }
        await c.query(`INSERT INTO gameai.comments(project_id,task_id,execution_id,body) VALUES($1,$2,$3,$4)`,[job.projectId,job.taskId,job.executionId,
            `${success && task.role_code==='QA' && content.verdict==='fail' ? 'QA 发现缺陷，已建立返修任务' : completed ? '工程交付校验通过' : success ? '执行完成，等待验收' : '执行未通过'}\n${summary}`]);
        await c.query(`UPDATE gameai.tasks parent SET progress=summary.progress,status=CASE WHEN summary.completed THEN 'completed' WHEN summary.finished THEN 'review' ELSE 'running' END
            FROM (SELECT parent_id,round(100.0*count(*) FILTER(WHERE status='completed')/count(*))::int progress,bool_and(status IN ('completed','review')) finished,bool_and(status='completed') completed
                FROM gameai.tasks WHERE parent_id=$1 GROUP BY parent_id) summary WHERE parent.id=summary.parent_id`,[task.parent_id]);
        await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator',$2,$3)`,[job.projectId,success ? completed ? '工程交付校验通过，通知后续任务' : '任务执行结束，等待人工验收' : '任务执行失败或待核实',{task_id:job.taskId,execution_id:job.executionId,state,summary:content?.summary,error:error ?? null}]);
        await c.query(`INSERT INTO gameai.workflow_outbox(event_key,plan_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,['execution:'+job.executionId,task.plan_version_id]);
        await c.query('COMMIT');
        return {success,completed};
    }
    catch(error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
}
