SET search_path=gameai,public;
CREATE TABLE approval_workflows (
    version_id uuid PRIMARY KEY,
    project_id uuid NOT NULL,
    requested_by uuid NOT NULL REFERENCES users(id),
    revision text NOT NULL,
    document_hash text NOT NULL,
    state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','pm','dispatched','failed')),
    error text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(project_id,version_id) REFERENCES requirement_versions(project_id,id)
);
