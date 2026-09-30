SET search_path=gameai,public;
INSERT INTO permissions(code) VALUES('task.edit');
INSERT INTO role_permissions(role_code,permission_code) VALUES('Design','task.edit'),('Admin','task.edit');
ALTER TABLE tasks ADD COLUMN content_revision integer NOT NULL DEFAULT 0 CHECK(content_revision>=0);
CREATE TABLE task_edits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    revision integer NOT NULL,
    field text NOT NULL,
    before_value jsonb NOT NULL,
    after_value jsonb NOT NULL,
    edited_by uuid NOT NULL REFERENCES users(id),
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(task_id,revision),
    FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id)
);
GRANT SELECT ON task_edits TO gameai_track;
