SET search_path=gameai,public;

-- Preserve the previous public identifier without changing UUID relationships.
ALTER TABLE tasks ADD COLUMN legacy_task_key text;
CREATE SEQUENCE task_number_seq AS bigint MINVALUE 1 MAXVALUE 9999999 NO CYCLE;

CREATE FUNCTION assign_task_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,gameai AS $$
BEGIN
    NEW.task_key := CASE NEW.role_code
        WHEN 'Design' THEN 'D' WHEN 'Art' THEN 'A'
        WHEN 'Development' THEN 'P' WHEN 'QA' THEN 'Q'
        WHEN 'PM' THEN 'T' END
        || '-' || lpad(nextval('gameai.task_number_seq')::text,7,'0');
    RETURN NEW;
END;
$$;

-- Allocate in creation order; parents/dependencies/executions continue to reference UUIDs.
DO $$
DECLARE task record;
BEGIN
    FOR task IN SELECT id,role_code,task_key FROM tasks ORDER BY created_at,id LOOP
        UPDATE tasks SET legacy_task_key=task.task_key,
            task_key=CASE task.role_code WHEN 'Design' THEN 'D' WHEN 'Art' THEN 'A'
                WHEN 'Development' THEN 'P' WHEN 'QA' THEN 'Q' WHEN 'PM' THEN 'T' END
                || '-' || lpad(nextval('gameai.task_number_seq')::text,7,'0')
            WHERE id=task.id;
    END LOOP;
END;
$$;

ALTER TABLE tasks ADD CONSTRAINT tasks_number_format CHECK(
    task_key ~ '^[DAPQT]-[0-9]{7}$' AND left(task_key,1)=CASE role_code
        WHEN 'Design' THEN 'D' WHEN 'Art' THEN 'A' WHEN 'Development' THEN 'P'
        WHEN 'QA' THEN 'Q' WHEN 'PM' THEN 'T' END);
CREATE TRIGGER tasks_assign_number BEFORE INSERT ON tasks
FOR EACH ROW EXECUTE FUNCTION assign_task_number();
