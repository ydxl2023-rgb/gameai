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
        const versions = (await client.query(`SELECT v.*, r.title, r.requirement_key, a.decision,
            (SELECT jsonb_build_object('path',ar.storage_key,'id',ar.id) FROM artifact_links al JOIN artifacts ar ON ar.id=al.artifact_id
                WHERE al.requirement_version_id=v.id AND ar.media_type='text/html'
                ORDER BY ar.storage_key LIMIT 1) document_path FROM requirement_versions v
            JOIN requirements r ON r.id=v.requirement_id LEFT JOIN approvals a ON a.version_id=v.id
            WHERE v.project_id=$1 ORDER BY r.created_at DESC, v.ordinal DESC`, params)).rows;
        if (!versions.length)
        {
            throw new Error('项目尚无需求版本。');
        }
        const tasks = (await client.query(`SELECT t.*, v.version, ag.agent_key,
            COALESCE((SELECT jsonb_agg(dt.task_key ORDER BY dt.task_key) FROM task_dependencies d
                JOIN tasks dt ON dt.id=d.depends_on_id WHERE d.task_id=t.id),'[]') dependencies
            FROM tasks t JOIN plan_versions p ON p.id=t.plan_version_id
            JOIN requirement_versions v ON v.id=p.requirement_version_id
            LEFT JOIN executions e ON e.task_id=t.id AND e.state IN ('assigned','running','unknown')
            LEFT JOIN agents ag ON ag.id=e.agent_id WHERE t.project_id=$1 ORDER BY t.task_key`, params)).rows;
        const agents = (await client.query(`SELECT a.*, w.name station,w.capacity,w.last_heartbeat_at,w.enabled worker_enabled,
            (SELECT count(*)::int FROM executions e WHERE e.agent_id=a.id AND e.state IN ('assigned','running','unknown')) used,
            (SELECT t.task_key FROM executions e JOIN tasks t ON t.id=e.task_id WHERE e.agent_id=a.id
                AND e.state IN ('assigned','running','unknown') ORDER BY e.started_at LIMIT 1) task,
            EXISTS(SELECT 1 FROM agent_grants g WHERE g.agent_id=a.id AND permission_code='project.read') read,
            EXISTS(SELECT 1 FROM agent_grants g WHERE g.agent_id=a.id AND permission_code='task.write_assigned') write
            FROM agents a JOIN workers w ON w.id=a.worker_id WHERE a.project_id=$1 ORDER BY a.agent_key`, params)).rows;
        const audit = (await client.query('SELECT id::text,actor,event,created_at FROM audit_events WHERE project_id=$1 ORDER BY id DESC LIMIT 200', params)).rows;
        await client.query('COMMIT');
        const state = value => value === 'approved' ? '已批准' : value === 'rejected' ? '退回修改' : '待审批';
        const latest = versions[0];
        return {
            is_test: project.is_test,
            workbench: {
                project: { key: project.project_key, name: project.name },
                requirement: { title: latest.title, version: latest.version, revision: latest.content_hash, status: state(latest.decision), ...latest.content },
                requirements: versions.filter((v, i, rows) => rows.findIndex(other => other.requirement_id === v.requirement_id) === i).map(v => ({ id: v.requirement_key, title: v.title, version: v.version, revision: v.content_hash, status: state(v.decision), document_path: v.document_path?.path ?? null, document_url: v.document_path ? `${process.env.GAMEAI_TRACK_ORIGIN ?? `http://127.0.0.1:${process.env.GAMECLI_TRACK_PORT ?? 8090}`}/api/track/documents/${v.document_path.id}` : null, created_at: v.created_at.toISOString(), ...v.content })),
                versions: versions.map(v => ({ version: v.version, status: state(v.decision), change: v.content.changes.join('；'), reference: '数据库存档', revision: v.content_hash, content: v.content })),
                tasks: tasks.map(t => ({ id: t.task_key, title: t.title, role: t.role_code, agent: t.agent_key ?? null, status: states[t.status], progress: t.progress, dependencies: t.dependencies, version: t.version })),
                agents: agents.map(a => ({ id: a.agent_key, role: a.role_code, status: !a.enabled || !a.worker_enabled || !a.last_heartbeat_at || Date.now() - new Date(a.last_heartbeat_at).getTime() > 60000 ? '离线' : a.used ? '执行中' : '空闲', task: a.task ?? null, used: a.used, capacity: a.capacity, station: a.station, read: a.read, write: a.write })),
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
