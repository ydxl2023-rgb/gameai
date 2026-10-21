import {ReviewError} from './requirements.js';
import {designExecutionIds} from './recovery-protocol.js';

export async function validateRoleOperationClaim(c,projectId,input,agentId)
{
    if (input.role==='PM')
    {
        const stage=(await c.query('SELECT parent_execution_id FROM gameai.pm_stages WHERE execution_id=$1',[input.execution_id])).rows[0];
        const operationId=stage?.parent_execution_id ?? input.execution_id;
        const job=(await c.query(`SELECT * FROM gameai.pm_jobs WHERE project_id=$1 AND
            (execution_id=$2 OR recovery_history @> $3::jsonb)`,[projectId,operationId,JSON.stringify([{execution_id:operationId}])])).rows[0];
        if (job && (job.execution_id!==operationId || job.state!=='running' || new Date(job.expires_at)<=new Date() ||
            (job.recovery_agent_id && job.recovery_agent_id!==agentId)))
        {
            throw new ReviewError('PM 原操作已结束、过期或被恢复执行替代，拒绝迟到 claim。');
        }
    }
    if (input.role==='Design')
    {
        const revisions=(await c.query('SELECT * FROM gameai.requirement_revisions WHERE project_id=$1 AND recovery_execution_id IS NOT NULL',[projectId])).rows;
        for (const job of revisions)
        {
            const operations=[job.recovery_execution_id,...job.recovery_history.map(h=>h.execution_id)];
            const matched=operations.find(id=>designExecutionIds(id).includes(input.execution_id));
            if (matched && (matched!==job.recovery_execution_id || job.state!=='running' || job.design_agent_id!==agentId ||
                new Date(job.started_at).getTime()+20*60*1000<=Date.now()))
            {
                throw new ReviewError('Design 原修订操作已结束、过期或被恢复执行替代，拒绝迟到 claim。');
            }
        }
    }
}
