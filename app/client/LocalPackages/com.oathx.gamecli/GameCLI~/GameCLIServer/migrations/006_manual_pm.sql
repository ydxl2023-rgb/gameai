SET search_path=gameai,public;

ALTER TABLE tasks ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN source_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(source_refs)='array');
ALTER TABLE tasks ADD COLUMN parent_id uuid;
ALTER TABLE tasks ADD CONSTRAINT tasks_parent_fk FOREIGN KEY(project_id,parent_id) REFERENCES tasks(project_id,id);
ALTER TABLE tasks ADD CONSTRAINT tasks_not_self_parent CHECK(parent_id IS DISTINCT FROM id);

CREATE TABLE pm_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    requirement_version_id uuid NOT NULL UNIQUE,
    execution_id text NOT NULL UNIQUE CHECK(execution_id ~ '^[0-9a-f]{32}$'),
    requested_by uuid NOT NULL REFERENCES users(id),
    revision text NOT NULL,
    document_hash text NOT NULL,
    state text NOT NULL CHECK(state IN ('running','completed','failed','unknown')),
    attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3),
    plan_version_id uuid,
    error text NOT NULL DEFAULT '',
    task_count integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '20 minutes',
    finished_at timestamptz,
    FOREIGN KEY(project_id,requirement_version_id) REFERENCES requirement_versions(project_id,id),
    FOREIGN KEY(project_id,plan_version_id) REFERENCES plan_versions(project_id,id)
);
CREATE UNIQUE INDEX pm_jobs_one_active_project ON pm_jobs(project_id) WHERE state IN ('running','unknown');
GRANT SELECT ON pm_jobs TO gameai_track;
