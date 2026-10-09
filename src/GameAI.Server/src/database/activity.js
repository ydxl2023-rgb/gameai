// Project-scoped durable events, enriched with public identifiers only.
export async function readActivity(client, projectId)
{
    const {rows} = await client.query(`
        SELECT a.id::text, a.created_at time, a.event message, a.actor,
            COALESCE(t.task_key,a.payload->>'task') task,
            COALESCE(ag.agent_key,a.payload->>'agent') agent,
            COALESCE(r.requirement_key,ac.requirement_key,a.payload->>'requirement_key') requirement,
            a.payload->>'task_count' task_count,
            CASE WHEN a.event ~ '失败|结束|完成|校验|退回' THEN COALESCE(NULLIF(a.payload->>'reason',''),NULLIF(a.payload->>'error',''),NULLIF(ar.error,''),e.result->>'error','') ELSE '' END reason,
            COALESCE(a.payload->>'summary',(SELECT left(c.body,3000) FROM gameai.comments c WHERE c.execution_id=e.id AND a.event ~ '结束|校验|失败' ORDER BY c.created_at DESC LIMIT 1)) summary,
            COALESCE(a.payload->>'state',ar.state) state
        FROM (SELECT * FROM gameai.audit_events WHERE project_id=$1 ORDER BY id DESC LIMIT 500) a
        LEFT JOIN gameai.agent_runs ar ON EXISTS(SELECT 1 FROM gameai.agent_conversations scope WHERE scope.id=ar.conversation_id AND scope.project_id=a.project_id) AND ar.execution_id=replace(a.payload->>'execution_id','-','')
        LEFT JOIN gameai.agent_conversations ac ON ac.id=ar.conversation_id
        LEFT JOIN gameai.executions e ON e.project_id=a.project_id AND replace(e.id::text,'-','')=replace(a.payload->>'execution_id','-','')
        LEFT JOIN gameai.tasks t ON t.project_id=a.project_id AND t.id::text=COALESCE(a.payload->>'task_id',e.task_id::text)
        LEFT JOIN gameai.agents ag ON ag.id=COALESCE(e.agent_id,ac.agent_id)
        LEFT JOIN gameai.plan_versions pv ON pv.project_id=a.project_id AND pv.id::text=COALESCE(a.payload->>'plan_version_id',t.plan_version_id::text)
        LEFT JOIN gameai.requirement_versions v ON v.project_id=a.project_id AND v.id::text=COALESCE(a.payload->>'version_id',pv.requirement_version_id::text)
        LEFT JOIN gameai.requirements r ON r.id=v.requirement_id
        ORDER BY a.id`, [projectId]);
    return rows.map(row => ({
        id:row.id, time:row.time.toISOString(), actor:row.agent && row.agent !== row.actor ? `${row.actor} · Agent ${row.agent}` : row.actor,
        requirement:row.requirement, task:row.task,
        level:row.state === 'unknown' ? 'warning' : /失败|退回|缺陷/.test(row.message) ? 'error' : 'info',
        message:[row.message, row.task_count ? `共 ${row.task_count} 项子任务` : '', row.summary, row.reason].filter(Boolean).join('；')
    }));
}
