import {z} from 'zod';

export const collaborationQuery = z.object({
    before:z.string().regex(/^[1-9][0-9]{0,18}$/).optional(),
    role:z.enum(['Human','Orchestrator','Design','PM','Prefab','Art','Development','QA']).optional(),
    search:z.string().trim().max(120).optional()
}).strict();

export async function readCollaboration(pool, projectKey, raw={})
{
    const q=collaborationQuery.parse(raw);
    const {rows}=await pool.query(`SELECT m.id::text,m.created_at,m.actor_name,m.role,m.event,m.body,m.level,
        m.requirement_key,m.requirement_title,m.version,m.version_id,m.task_key,m.task_id,m.artifact_id,
        EXISTS(SELECT 1 FROM gameai.tasks t WHERE t.id=m.task_id AND t.project_id=m.project_id) task_available,
        EXISTS(SELECT 1 FROM gameai.artifact_links l JOIN gameai.document_contents d ON d.artifact_id=l.artifact_id
            WHERE l.project_id=m.project_id AND l.artifact_id=m.artifact_id) document_available
        FROM gameai.collaboration_messages m JOIN gameai.projects p ON p.id=m.project_id
        WHERE p.project_key=$1 AND ($2::bigint IS NULL OR m.id<$2::bigint) AND ($3::text IS NULL OR m.role=$3)
        AND m.id>COALESCE((SELECT max((a.payload->>'collaboration_reset_before')::bigint) FROM gameai.audit_events a
            WHERE a.project_id=m.project_id AND a.event='tasks.cleared' AND a.payload ? 'collaboration_reset_before'),0)
        AND ($4::text IS NULL OR strpos(lower(concat_ws(' ',m.requirement_key,m.requirement_title,m.task_key,m.actor_name)),lower($4))>0)
        ORDER BY m.id DESC LIMIT 51`,[projectKey,q.before??null,q.role??null,q.search||null]);
    const items=rows.slice(0,50);
    return {messages:items.reverse(),before:rows.length>50?items[0].id:null};
}
