SET search_path=gameai,public;
CREATE TABLE task_dispatch_jobs (
    execution_id uuid PRIMARY KEY REFERENCES executions(id),
    project_id uuid NOT NULL REFERENCES projects(id),
    requested_by uuid NOT NULL REFERENCES users(id),
    requirement_key text NOT NULL,
    input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '20 minutes'
);
