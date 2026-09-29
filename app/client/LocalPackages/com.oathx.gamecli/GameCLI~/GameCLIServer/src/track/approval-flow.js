import {startPmJob} from '../database/pm-plans.js';
import {checkPmRuntime,dispatchPmJob} from './pm-dispatch.js';
import {resumeTaskFlows} from './task-flow.js';

// A durable, version-bound human choice is the only entry into automatic publication.
export async function resumeApprovalWorkflows(pool)
{
    const pending=(await pool.query("SELECT w.*,p.project_key FROM gameai.approval_workflows w JOIN gameai.projects p ON p.id=w.project_id WHERE w.state='queued' ORDER BY w.updated_at")).rows;
    for (const workflow of pending)
    {
        const claimed=await pool.query("UPDATE gameai.approval_workflows SET state='pm',updated_at=now() WHERE version_id=$1 AND state='queued' RETURNING version_id",[workflow.version_id]);
        if (!claimed.rowCount) continue;
        try
        {
            await checkPmRuntime();
            const started=await startPmJob(pool,workflow.project_key,workflow.requested_by,{version_id:workflow.version_id,revision:workflow.revision,document_hash:workflow.document_hash});
            if (started.created) await dispatchPmJob(pool,workflow.project_key,started);
            const state=(await pool.query('SELECT state FROM gameai.approval_workflows WHERE version_id=$1',[workflow.version_id])).rows[0].state;
            if (state!=='dispatched') throw new Error('PM 未发布自动计划，请查看 PM 执行记录；不会重复调用仍在运行的 Agent。');
            await resumeTaskFlows(pool);
        }
        catch(error)
        {
            await pool.query("UPDATE gameai.approval_workflows SET state='failed',error=$2,updated_at=now() WHERE version_id=$1 AND state='pm'",[workflow.version_id,error.message.slice(0,2000)]);
        }
    }
}
