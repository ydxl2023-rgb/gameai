import {verifyTaskFiles} from './task-files.js';

export async function ensureQaTasks(c,planId)
{
    const sources=(await c.query(`SELECT t.* FROM gameai.tasks t WHERE t.plan_version_id=$1 AND t.role_code='Development'
        AND NOT EXISTS(SELECT 1 FROM gameai.qa_defects d WHERE d.repair_task_id=t.id)
        AND NOT EXISTS(SELECT 1 FROM gameai.task_dependencies edge JOIN gameai.tasks q ON q.id=edge.task_id WHERE edge.depends_on_id=t.id AND q.role_code='QA') ORDER BY t.task_key`,[planId])).rows;
    const created=[];
    for (const source of sources)
    {
        const qa=(await c.query(`INSERT INTO gameai.tasks(project_id,plan_version_id,parent_id,title,role_code,description,source_refs,delivery_criteria,status,qa_source_task_id,dispatch_allowed,dispatch_revision,dispatch_selected_by,dispatch_selected_at)
            VALUES($1,$2,$3,$4,'QA',$5,$6,$7,'blocked',$8,$9,$10,$11,$12) ON CONFLICT(qa_source_task_id) WHERE qa_source_task_id IS NOT NULL DO NOTHING RETURNING id`,
            [source.project_id,planId,source.parent_id,'验收：'+source.title,'验证 '+source.task_key+' 的全部交付标准。读取真实产物并执行测试，提交报告。区分缺陷与环境阻塞；缺陷必须有复现步骤、预期、实际结果和证据。',JSON.stringify(source.source_refs),JSON.stringify(source.delivery_criteria),source.id,source.dispatch_allowed,source.dispatch_allowed?1:0,source.dispatch_selected_by,source.dispatch_selected_at])).rows[0];
        if (!qa) continue;
        await c.query('INSERT INTO gameai.task_dependencies(project_id,task_id,depends_on_id) VALUES($1,$2,$3)',[source.project_id,qa.id,source.id]);
        created.push(qa.id);
    }
    return created;
}

// Keep original manifests immutable; successful fixes overlay only their changed paths.
export async function effectiveDelivery(c,taskId)
{
    const original=(await c.query("SELECT id,agent_id,started_at,result->'artifacts' artifacts FROM gameai.executions WHERE task_id=$1 AND state='succeeded' ORDER BY started_at DESC LIMIT 1",[taskId])).rows[0];
    if (!original) return {artifacts:[]};
    const files=new Map((original.artifacts ?? []).map(a=>[a.path,a]));
    const fixes=(await c.query(`SELECT e.result->'artifacts' artifacts FROM gameai.qa_defects d JOIN gameai.executions e ON e.task_id=d.repair_task_id WHERE d.source_task_id=$1 AND e.state='succeeded' AND e.started_at>$2 ORDER BY e.started_at`,[taskId,original.started_at])).rows;
    for (const fix of fixes) for (const file of fix.artifacts ?? []) files.set(file.path,file);
    return {execution_id:original.id,agent_id:original.agent_id,artifacts:[...files.values()]};
}
export async function loadTaskContext(c,task)
{
    const dependencies=(await c.query(`SELECT t.id,t.task_key,t.status,t.role_code,(SELECT e.result->'result'->>'Text' FROM gameai.executions e WHERE e.task_id=t.id AND e.state='succeeded' ORDER BY e.started_at DESC LIMIT 1) report FROM gameai.task_dependencies d JOIN gameai.tasks t ON t.id=d.depends_on_id WHERE d.task_id=$1 ORDER BY t.task_key`,[task.id])).rows;
    for (const dependency of dependencies)
    {
        Object.assign(dependency,await effectiveDelivery(c,dependency.id));
        let verdict;
        try {verdict=JSON.parse(dependency.report ?? '{}').verdict;} catch {}
        dependency.accepted=dependency.status==='completed' || (dependency.role_code==='QA' && dependency.status==='review' && verdict==='pass');
        delete dependency.report;
    }
    const repair=(await c.query(`SELECT d.*,s.task_key source_task_key,q.task_key qa_task_key FROM gameai.qa_defects d JOIN gameai.tasks s ON s.id=d.source_task_id JOIN gameai.tasks q ON q.id=d.qa_task_id WHERE repair_task_id=$1`,[task.id])).rows[0];
    if (repair) repair.source_delivery=await effectiveDelivery(c,repair.source_task_id);
    const retests=task.role_code==='QA' ? (await c.query(`SELECT d.*,t.task_key repair_task_key FROM gameai.qa_defects d JOIN gameai.tasks t ON t.id=d.repair_task_id WHERE qa_task_id=$1 AND d.state<>'closed' ORDER BY d.id`,[task.id])).rows : [];
    const blockers=repair ? [] : (await c.query(`WITH RECURSIVE upstream(id) AS (
        SELECT depends_on_id FROM gameai.task_dependencies WHERE task_id=$1 UNION SELECT d.depends_on_id FROM gameai.task_dependencies d JOIN upstream u ON d.task_id=u.id)
        SELECT d.id,d.qa_task_id,d.state FROM gameai.qa_defects d JOIN upstream u ON u.id=d.source_task_id WHERE d.state<>'closed'`,[task.id])).rows;
    return JSON.parse(JSON.stringify({dependencies,repair:repair ?? null,retests,blockers}));
}
export async function contextBlockReason(context,task)
{
    if (context.repair && (context.repair.state!=='open' || (context.repair.rounds>=3 && task.status!=='running'))) return '返修任务等待 QA 复测、已关闭或达到三轮上限';
    if (context.retests.some(d=>d.state!=='retest')) return '等待返修交付，当前不能复测';
    if (context.blockers.some(d=>task.role_code!=='QA' || d.state!=='retest')) return '上游存在尚未通过 QA 复测的缺陷';
    if (task.role_code==='QA' && !context.dependencies.some(d=>d.role_code==='Development' && d.execution_id && d.agent_id)) return '缺少可追溯的原开发任务交付，不能执行 QA';
    for (const dependency of context.dependencies)
    {
        if (!dependency.accepted) return '依赖未完成：'+dependency.task_key;
        if (!await verifyTaskFiles(dependency.artifacts)) return '依赖交付文件缺失或版本改变：'+dependency.task_key;
    }
    return '';
}
