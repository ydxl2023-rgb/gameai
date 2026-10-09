INSERT INTO gameai.roles(code) VALUES ('Prefab') ON CONFLICT DO NOTHING;
INSERT INTO gameai.role_permissions(role_code,permission_code) VALUES ('Prefab','project.read') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION gameai.assign_task_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,gameai AS $$
BEGIN
    NEW.task_key := CASE NEW.role_code
        WHEN 'Design' THEN 'D' WHEN 'Art' THEN 'A' WHEN 'Prefab' THEN 'F'
        WHEN 'Development' THEN 'P' WHEN 'QA' THEN 'Q' WHEN 'PM' THEN 'T' END
        || '-' || lpad(nextval('gameai.task_number_seq')::text,7,'0');
    RETURN NEW;
END;
$$;
ALTER TABLE gameai.tasks DROP CONSTRAINT tasks_number_format;
ALTER TABLE gameai.tasks ADD CONSTRAINT tasks_number_format CHECK(
    task_key ~ '^[DAPQTF]-[0-9]{7}$' AND left(task_key,1)=CASE role_code
        WHEN 'Design' THEN 'D' WHEN 'Art' THEN 'A' WHEN 'Prefab' THEN 'F'
        WHEN 'Development' THEN 'P' WHEN 'QA' THEN 'Q' WHEN 'PM' THEN 'T' END);
