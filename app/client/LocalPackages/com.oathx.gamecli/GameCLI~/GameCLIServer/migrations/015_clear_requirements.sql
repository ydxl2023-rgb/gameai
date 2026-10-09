-- A narrow maintenance entrypoint: ordinary writes retain immutable document guards.
CREATE FUNCTION gameai.clear_project_requirements(target uuid, actor_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,gameai AS $$
DECLARE removed integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(target::text,0));
    IF NOT EXISTS(SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
        JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code
        WHERE u.id=actor_id AND u.enabled AND ur.project_id=target AND rp.permission_code='requirement.approve') THEN
        RAISE EXCEPTION 'Human approver required';
    END IF;
    IF EXISTS(SELECT 1 FROM gameai.plans WHERE project_id=target)
       OR EXISTS(SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id
           WHERE s.project_id=target AND r.state IN ('running','unknown')) THEN
        RAISE EXCEPTION 'Project must be idle and plans cleared first';
    END IF;
    -- ACCESS EXCLUSIVE locks remain held until commit, so no concurrent writer bypasses guards.
    ALTER TABLE gameai.approvals DISABLE TRIGGER immutable_approval;
    ALTER TABLE gameai.requirement_versions DISABLE TRIGGER immutable_requirement_version;
    ALTER TABLE gameai.document_contents DISABLE TRIGGER immutable_document;
    DELETE FROM gameai.approvals WHERE project_id=target;
    DELETE FROM gameai.artifact_links WHERE project_id=target;
    DELETE FROM gameai.document_contents WHERE artifact_id IN (SELECT id FROM gameai.artifacts WHERE project_id=target);
    DELETE FROM gameai.artifacts WHERE project_id=target;
    DELETE FROM gameai.requirement_versions WHERE project_id=target;
    DELETE FROM gameai.requirements WHERE project_id=target;
    GET DIAGNOSTICS removed = ROW_COUNT;
    ALTER TABLE gameai.approvals ENABLE TRIGGER immutable_approval;
    ALTER TABLE gameai.requirement_versions ENABLE TRIGGER immutable_requirement_version;
    ALTER TABLE gameai.document_contents ENABLE TRIGGER immutable_document;
    RETURN removed;
END $$;
REVOKE ALL ON FUNCTION gameai.clear_project_requirements(uuid,uuid) FROM PUBLIC;
