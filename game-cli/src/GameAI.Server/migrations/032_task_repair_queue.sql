-- Recovery is durable server work, not a side effect of an in-memory retry loop.
CREATE TABLE gameai.task_repairs (
    execution_id uuid PRIMARY KEY REFERENCES gameai.executions(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES gameai.projects(id),
    task_id uuid NOT NULL REFERENCES gameai.tasks(id) ON DELETE CASCADE,
    plan_version_id uuid NOT NULL REFERENCES gameai.plan_versions(id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','diagnosing','waiting','ready','dispatched','resolved','attention','cancelled')),
    code text NOT NULL,
    fingerprint text NOT NULL,
    progress_hash text NOT NULL,
    decision jsonb NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}',
    probes integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_repairs_due ON gameai.task_repairs(next_attempt_at) WHERE state IN ('pending','diagnosing','waiting','ready');
GRANT SELECT ON gameai.task_repairs TO gameai_track;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gameai_workflow') THEN
        GRANT SELECT,INSERT,UPDATE ON gameai.task_repairs TO gameai_workflow;
    END IF;
END $$;
