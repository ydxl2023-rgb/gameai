import {ReviewError} from './requirements.js';

export function validateQaReport(context,report)
{
    const expected=new Map(context.retests.map(d=>[d.id,d]));
    if (context.retests.some(d=>d.state!=='retest') || report.retests.length!==expected.size || report.retests.some(r=>!expected.has(r.defect_id))) throw new ReviewError('必须逐一复测本轮全部返修项，不得引用其他缺陷。');
    for (const defect of report.defects)
    {
        if (!context.dependencies.some(d=>d.role_code==='Development' && d.task_key===defect.source_task_key && d.execution_id && d.agent_id)) throw new ReviewError('缺陷只能关联本次 QA 验收的原开发交付。');
        const prior=context.retests.find(d=>d.source_task_id===context.dependencies.find(s=>s.task_key===defect.source_task_key)?.id && d.case_key===defect.case_key);
        if (prior && report.retests.find(r=>r.defect_id===prior.id)?.passed) throw new ReviewError('同一缺陷不能同时复测通过和报告失败。');
    }
    for (const retest of report.retests.filter(r=>!r.passed))
    {
        const prior=expected.get(retest.defect_id);
        if (!report.defects.some(d=>d.case_key===prior.case_key && context.dependencies.find(s=>s.task_key===d.source_task_key)?.id===prior.source_task_id)) throw new ReviewError('复测失败必须沿用原 case_key 并补充本轮复现证据。');
    }
}

export async function applyQaReport(c,task,execution,context,report)
{
    await c.query('UPDATE gameai.tasks SET bound_agent_id=$2 WHERE id=$1',[task.id,execution.agent_id]);
    for (const retest of report.retests.filter(r=>r.passed))
    {
        const defect=context.retests.find(d=>d.id===retest.defect_id);
        await c.query("UPDATE gameai.qa_defects SET state='closed',updated_at=now() WHERE id=$1",[defect.id]);
        await c.query("UPDATE gameai.tasks SET status='completed',progress=100 WHERE id=$1",[defect.repair_task_id]);
    }
    for (const defect of report.defects)
    {
        const source=context.dependencies.find(d=>d.task_key===defect.source_task_key);
        const prior=(await c.query('SELECT * FROM gameai.qa_defects WHERE qa_task_id=$1 AND source_task_id=$2 AND case_key=$3',[task.id,source.id,defect.case_key])).rows[0];
        let repairId=prior?.repair_task_id;
        if (!prior)
        {
            const description=`原开发任务：${source.task_key}\n原 QA 任务：${task.task_key}\n缺陷编号：${defect.case_key}\n前置条件：${defect.preconditions}\n操作步骤：${defect.steps}\n预期结果：${defect.expected}\n实际结果：${defect.actual}\n证据：${defect.evidence_path}\n修复验收：${defect.fix_acceptance}`;
            repairId=(await c.query(`INSERT INTO gameai.tasks(project_id,plan_version_id,parent_id,title,role_code,description,delivery_criteria,source_refs,bound_agent_id,dispatch_allowed,dispatch_revision,dispatch_selected_by,dispatch_selected_at)
                VALUES($1,$2,$3,$4,'Development',$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[task.project_id,task.plan_version_id,task.parent_id,'返修：'+defect.title,description,JSON.stringify([{kind:'tests',text:defect.fix_acceptance}]),JSON.stringify(task.source_refs),source.agent_id,task.dispatch_allowed,task.dispatch_allowed?1:0,task.dispatch_selected_by,task.dispatch_selected_at])).rows[0].id;
            await c.query(`INSERT INTO gameai.qa_defects(project_id,qa_task_id,source_task_id,repair_task_id,source_execution_id,developer_agent_id,qa_agent_id,case_key,details)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[task.project_id,task.id,source.id,repairId,source.execution_id,source.agent_id,execution.agent_id,defect.case_key,JSON.stringify(defect)]);
        }
        else
        {
            const exhausted=prior.rounds>=3;
            await c.query('UPDATE gameai.qa_defects SET state=$2,details=$3,updated_at=now() WHERE id=$1',[prior.id,exhausted?'exhausted':'open',JSON.stringify(defect)]);
            await c.query("UPDATE gameai.tasks SET status=$2,progress=0 WHERE id=$1",[repairId,exhausted?'failed':'pending']);
            if (exhausted) await c.query("UPDATE gameai.plan_dispatch_flows SET state='paused',reason='同一缺陷三轮返修仍未通过，请人工处理',updated_at=now() WHERE plan_version_id=$1",[task.plan_version_id]);
        }
        await c.query("INSERT INTO gameai.comments(project_id,task_id,execution_id,body) VALUES($1,$2,$3,$4)",[task.project_id,task.id,execution.id,'返修任务：'+repairId+'\nQA 缺陷：'+defect.title+'\n'+defect.actual+'\n复现：'+defect.steps+'\n证据：'+defect.evidence_path]);
        // Completed downstream work must be rechecked after its input is known to be defective.
        await c.query(`WITH RECURSIVE downstream(id) AS (
            SELECT task_id FROM gameai.task_dependencies WHERE depends_on_id=$1 UNION SELECT d.task_id FROM gameai.task_dependencies d JOIN downstream s ON d.depends_on_id=s.id)
            UPDATE gameai.tasks SET status='blocked',progress=0 WHERE id IN(SELECT id FROM downstream) AND status IN('completed','review')`,[source.id]);
        await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'orchestrator','QA 缺陷交回原开发 Agent',$2)",[task.project_id,{qa_task_id:task.id,source_task_id:source.id,repair_task_id:repairId,developer_agent_id:prior?.developer_agent_id ?? source.agent_id,case_key:defect.case_key}]);
    }
    await c.query('UPDATE gameai.tasks SET status=$2,progress=$3 WHERE id=$1',[task.id,report.verdict==='pass'?'review':'blocked',report.verdict==='pass'?100:0]);
}

export async function finishRepair(c,task,defect)
{
    await c.query("UPDATE gameai.qa_defects SET state='retest',updated_at=now() WHERE id=$1",[defect.id]);
    await c.query("UPDATE gameai.tasks SET status='review',progress=100 WHERE id=$1",[task.id]);
    await c.query("UPDATE gameai.tasks SET status='blocked',progress=0 WHERE id=$1",[defect.qa_task_id]);
}
