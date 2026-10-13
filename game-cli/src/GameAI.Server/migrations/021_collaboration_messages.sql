SET search_path=gameai,public;
-- Snapshot public facts in the business transaction. No FK to disposable business rows.
CREATE TABLE collaboration_messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id),
    source_event_id bigint NOT NULL UNIQUE,
    created_at timestamptz NOT NULL,
    actor_name text NOT NULL,
    role text NOT NULL,
    event text NOT NULL,
    body text NOT NULL,
    level text NOT NULL,
    requirement_key text,
    requirement_title text,
    version text,
    version_id uuid,
    task_key text,
    task_id uuid,
    artifact_id uuid
);
CREATE INDEX collaboration_project_cursor ON collaboration_messages(project_id,id DESC);
CREATE INDEX collaboration_project_requirement ON collaboration_messages(project_id,requirement_key,id DESC);
CREATE FUNCTION capture_collaboration_message(a gameai.audit_events) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=gameai,pg_temp AS $$
DECLARE t record; v record; ag record; u text; artifact uuid; details text;
BEGIN
    IF a.event !~ '需求|审批|批准|拒绝|拆分|修订|执行|任务|交付|验收|派发|返修|完成|停止|退回'
       OR a.event ~ '清空|权限|授权配置|登录|登出' THEN RETURN; END IF;
    SELECT x.* INTO t FROM tasks x LEFT JOIN executions e ON e.task_id=x.id AND e.project_id=a.project_id
        WHERE x.project_id=a.project_id AND (x.id::text=a.payload->>'task_id' OR x.task_key=a.payload->>'task'
        OR replace(e.id::text,'-','')=replace(a.payload->>'execution_id','-','')) LIMIT 1;
    SELECT x.*,r.requirement_key,r.title INTO v FROM requirement_versions x JOIN requirements r ON r.id=x.requirement_id
        WHERE x.project_id=a.project_id AND (x.id::text=a.payload->>'version_id'
        OR x.id::text=a.payload->>'requirement_version_id'
        OR x.id=(SELECT requirement_version_id FROM plan_versions WHERE id=t.plan_version_id)
        OR (r.requirement_key=a.payload->>'requirement_key' AND NOT (a.payload ? 'version_id')))
        ORDER BY x.ordinal DESC LIMIT 1;
    SELECT x.* INTO ag FROM agents x WHERE x.project_id=a.project_id AND
        (x.agent_key=a.actor OR x.id::text=a.payload->>'agent_id' OR x.id=(SELECT s.agent_id FROM agent_runs ar
         JOIN agent_conversations s ON s.id=ar.conversation_id WHERE s.project_id=a.project_id AND ar.execution_id=replace(a.payload->>'execution_id','-','') LIMIT 1)
         OR x.id=(SELECT agent_id FROM fixed_agents WHERE project_id=a.project_id AND role_code=replace(a.actor,'agent:',''))) LIMIT 1;
    SELECT display_name INTO u FROM users WHERE id::text=replace(a.actor,'human:','');
    SELECT l.artifact_id INTO artifact FROM artifact_links l JOIN artifacts x ON x.id=l.artifact_id
        WHERE l.project_id=a.project_id AND x.media_type='text/html' AND
        ((t.id IS NOT NULL AND l.task_id=t.id) OR (t.id IS NULL AND l.requirement_version_id=v.id)) LIMIT 1;
    details=concat_ws(E'\n',NULLIF(a.payload->>'summary',''),NULLIF(a.payload->>'reason',''),NULLIF(a.payload->>'error',''));
    -- Do not persist raw prompts, model reasoning, JSON payloads or document source in chat.
    details=left(regexp_replace(details,'<[^>]*>','','g'),6000);
    INSERT INTO collaboration_messages(project_id,source_event_id,created_at,actor_name,role,event,body,level,
        requirement_key,requirement_title,version,version_id,task_key,task_id,artifact_id)
    VALUES(a.project_id,a.id,a.created_at,COALESCE(u,NULLIF(ag.display_name,''),ag.agent_key,CASE WHEN a.actor LIKE 'human:%' THEN '审批人' ELSE '编排器' END),
        CASE WHEN a.actor LIKE 'human:%' THEN 'Human' ELSE COALESCE(ag.role_code,'Orchestrator') END,a.event,details,
        CASE WHEN a.event ~ '失败|退回|中断|停止' THEN 'error' WHEN a.event ~ '等待|待审批' THEN 'warning' ELSE 'info' END,
        COALESCE(v.requirement_key,a.payload->>'requirement_key'),v.title,v.version,v.id,COALESCE(t.task_key,a.payload->>'task'),t.id,artifact)
    ON CONFLICT(source_event_id) DO NOTHING;
END $$;
CREATE FUNCTION collaboration_audit_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=gameai,pg_temp AS $$
BEGIN PERFORM capture_collaboration_message(NEW); RETURN NEW; END $$;
CREATE TRIGGER collaboration_event AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION collaboration_audit_trigger();
-- Existing audit facts are replayed once with original timestamps, never fabricated conversations.
SELECT capture_collaboration_message(a) FROM audit_events a ORDER BY a.id;
CREATE FUNCTION reject_collaboration_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Collaboration history is append-only'; END $$;
CREATE TRIGGER immutable_collaboration BEFORE UPDATE OR DELETE ON collaboration_messages FOR EACH ROW EXECUTE FUNCTION reject_collaboration_change();
REVOKE ALL ON FUNCTION capture_collaboration_message(gameai.audit_events) FROM PUBLIC;
REVOKE ALL ON FUNCTION collaboration_audit_trigger() FROM PUBLIC;
GRANT SELECT ON collaboration_messages TO gameai_track,gameai_workflow;
