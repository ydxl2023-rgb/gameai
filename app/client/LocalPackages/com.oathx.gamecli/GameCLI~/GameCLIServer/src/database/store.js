import { readActivity } from './activity.js';
const states = { pending: '待调度', blocked: '依赖阻塞', running: '执行中', review: '待验收', completed: '已完成', failed: '失败', cancelled: '已取消' };

export async function readWorkbench(pool, projectKey)
{
    const client = await pool.connect();
    try
    {
        // All lists must describe the same committed instant.
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query('SET LOCAL search_path=gameai,public');
        const project = (await client.query('SELECT * FROM projects WHERE project_key=$1', [projectKey])).rows[0];
        if (!project)
        {
            throw new Error('项目尚未初始化。');
        }
        const params = [project.id];
        const versions = (await client.query(`SELECT v.*,(SELECT jsonb_build_object('state',w.state,'error',w.error) FROM approval_workflows w WHERE w.version_id=v.id) approval_workflow, r.title, r.requirement_key, a.decision,
            (SELECT jsonb_build_object('state',CASE WHEN j.state='running' AND j.expires_at<=now() THEN 'unknown' ELSE j.state END,'error',j.error,'task_count',j.task_count,'attempts',j.attempts) FROM pm_jobs j WHERE j.requirement_version_id=v.id) pm_job,
            (SELECT jsonb_build_object('path',ar.storage_key,'id',ar.id,'hash',ar.sha256) FROM artifact_links al JOIN artifacts ar ON ar.id=al.artifact_id
                WHERE al.requirement_version_id=v.id AND ar.media_type='text/html'
                ORDER BY ar.storage_key LIMIT 1) document_path FROM requirement_versions v
            JOIN requirements r ON r.id=v.requirement_id LEFT JOIN approvals a ON a.version_id=v.id
            WHERE v.project_id=$1 ORDER BY r.created_at DESC, v.ordinal DESC`, params)).rows;
        if (!versions.length)
        {
            throw new Error('项目尚无需求版本。');
        }
        const tasks = (await client.query(`SELECT t.*, v.version,(SELECT jsonb_build_object('source_task',s.task_key,'qa_task',q.task_key,'state',d.state,'rounds',d.rounds,'details',d.details) FROM qa_defects d JOIN tasks s ON s.id=d.source_task_id JOIN tasks q ON q.id=d.qa_task_id WHERE d.repair_task_id=t.id) repair,(SELECT agent_key FROM agents WHERE id=t.bound_agent_id) bound_agent,(SELECT body FROM comments WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) last_result, ag.agent_key,CASE WHEN e.state IN ('assigned','running') AND EXISTS(SELECT 1 FROM task_dispatch_jobs j WHERE j.execution_id=e.id AND j.expires_at<=now()) THEN 'unknown' ELSE e.state END execution_state,(SELECT parent.task_key FROM tasks parent WHERE parent.id=t.parent_id) parent_key,
            COALESCE((SELECT jsonb_agg(dt.task_key ORDER BY dt.task_key) FROM task_dependencies d
                JOIN tasks dt ON dt.id=d.depends_on_id WHERE d.task_id=t.id),'[]') dependencies
            FROM tasks t JOIN plan_versions p ON p.id=t.plan_version_id
            JOIN requirement_versions v ON v.id=p.requirement_version_id
            LEFT JOIN executions e ON e.task_id=t.id AND e.state IN ('assigned','running','unknown')
            LEFT JOIN agents ag ON ag.id=e.agent_id WHERE t.project_id=$1 ORDER BY t.task_key`, params)).rows;
        const agents = (await client.query(`SELECT a.*, w.name station,w.capacity worker_capacity,w.last_heartbeat_at,w.enabled worker_enabled,
            EXISTS(SELECT 1 FROM fixed_agents f WHERE f.agent_id=a.id) fixed,
            (SELECT count(*)::int FROM agent_runs r JOIN agent_conversations s ON s.id=r.conversation_id WHERE s.agent_id=a.id AND r.state IN ('running','unknown') AND NOT EXISTS(SELECT 1 FROM executions e WHERE replace(e.id::text,'-','')=r.execution_id AND e.state IN ('assigned','running','unknown'))) cloud_used,
            EXISTS(SELECT 1 FROM agent_runs r JOIN agent_conversations s ON s.id=r.conversation_id WHERE s.agent_id=a.id AND (r.state='unknown' OR (r.state='running' AND r.expires_at<=now()))) OR EXISTS(SELECT 1 FROM executions e LEFT JOIN task_dispatch_jobs j ON j.execution_id=e.id WHERE e.agent_id=a.id AND (e.state='unknown' OR (e.state IN ('assigned','running') AND j.expires_at<=now()))) uncertain,
            (SELECT s.requirement_key FROM agent_runs r JOIN agent_conversations s ON s.id=r.conversation_id WHERE s.agent_id=a.id AND r.state IN ('running','unknown') ORDER BY r.started_at LIMIT 1) cloud_task,
            (SELECT count(*)::int FROM executions e WHERE e.agent_id=a.id AND e.state IN ('assigned','running','unknown')) used,
            (SELECT t.task_key FROM executions e JOIN tasks t ON t.id=e.task_id WHERE e.agent_id=a.id
                AND e.state IN ('assigned','running','unknown') ORDER BY e.started_at LIMIT 1) task,
            EXISTS(SELECT 1 FROM agent_grants g WHERE g.agent_id=a.id AND permission_code='project.read') read,
            EXISTS(SELECT 1 FROM agent_grants g WHERE g.agent_id=a.id AND permission_code='task.write_assigned') write,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('key',s.skill_key,'primary',s.is_primary,'hash',s.content_hash) ORDER BY s.is_primary DESC,s.skill_key) FROM agent_skills s WHERE s.agent_id=a.id),'[]') skills
            FROM agents a JOIN workers w ON w.id=a.worker_id WHERE a.project_id=$1 ORDER BY a.agent_key`, params)).rows;
        const flows=(await client.query('SELECT f.state,f.reason,r.requirement_key FROM plan_dispatch_flows f JOIN plan_versions pv ON pv.id=f.plan_version_id JOIN requirement_versions v ON v.id=pv.requirement_version_id JOIN requirements r ON r.id=v.requirement_id WHERE f.project_id=$1',params)).rows;
        const audit = (await client.query('SELECT id::text,actor,event,created_at FROM audit_events WHERE project_id=$1 ORDER BY id DESC LIMIT 200', params)).rows;
        const activity = await readActivity(client, project.id);
        await client.query('COMMIT');
        const state = value => value === 'approved' ? '已批准' : value === 'rejected' ? '退回修改' : '待审批';
        const latest = versions[0];
        return {
            is_test: project.is_test,
            workbench: {
                flows,
                activity,
                project: { key: project.project_key, name: project.name },
                requirement: { title: latest.title, version: latest.version, revision: latest.content_hash, status: state(latest.decision), ...latest.content },
                requirements: versions.filter((v, i, rows) => rows.findIndex(other => other.requirement_id === v.requirement_id) === i).map(v => ({ pm_job: v.pm_job, approval_workflow:v.approval_workflow, version_id: v.id, document_hash: v.document_path?.hash ?? null, id: v.requirement_key, title: v.title, version: v.version, revision: v.content_hash, status: state(v.decision), document_path: v.document_path?.path ?? null, document_url: v.document_path ? `${process.env.GAMEAI_TRACK_ORIGIN ?? `http://127.0.0.1:${process.env.GAMECLI_TRACK_PORT ?? 8090}`}/api/track/documents/${v.document_path.id}` : null, created_at: v.created_at.toISOString(), ...v.content })),
                versions: versions.map(v => ({ version: v.version, status: state(v.decision), change: v.content.changes.join('；'), reference: '数据库存档', revision: v.content_hash, content: v.content })),
                tasks: tasks.map(t => ({ id: t.task_key, task_uuid: t.id, repair:t.repair, bound_agent:t.bound_agent, last_result:t.last_result, dispatch_allowed: t.dispatch_allowed, dispatch_revision: t.dispatch_revision, parent_id: t.parent_key, description: t.description, source_refs: t.source_refs, criteria: t.delivery_criteria, title: t.title, role: t.role_code, agent: t.agent_key ?? null, status: t.execution_state === 'unknown' ? '待核实' : states[t.status], progress: t.progress, dependencies: t.dependencies, version: t.version })),
                agents: agents.map(a => ({ id: a.agent_key, name: a.display_name, fixed: a.fixed, enabled: a.enabled, skills: a.skills, role: a.role_code, status: a.uncertain ? '待核实' : a.used + a.cloud_used ? '执行中' : !a.enabled ? '已停用' : a.fixed ? '待启动' : !a.worker_enabled || !a.last_heartbeat_at || Date.now() - new Date(a.last_heartbeat_at).getTime() > 60000 ? '离线' : '空闲', task: a.task ?? a.cloud_task ?? null, used: a.used + a.cloud_used, capacity: a.capacity, station: a.station, read: a.read, write: a.write })),
                audit: audit.map(a => ({ id: a.id, time: a.created_at.toISOString(), actor: a.actor, event: a.event }))
            }
        };
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
