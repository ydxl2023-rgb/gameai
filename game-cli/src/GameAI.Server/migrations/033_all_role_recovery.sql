-- Repairs retain the original task, approved contract, execution history and Agent.
CREATE TABLE gameai.upstream_repairs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES gameai.projects(id),
    plan_version_id uuid NOT NULL REFERENCES gameai.plan_versions(id) ON DELETE CASCADE,
    requesting_execution_id uuid NOT NULL REFERENCES gameai.executions(id) ON DELETE CASCADE,
    requesting_task_id uuid NOT NULL REFERENCES gameai.tasks(id) ON DELETE CASCADE,
    source_task_id uuid NOT NULL REFERENCES gameai.tasks(id) ON DELETE CASCADE,
    source_execution_id uuid NOT NULL REFERENCES gameai.executions(id),
    source_agent_id uuid NOT NULL REFERENCES gameai.agents(id),
    state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','repaired','verified','attention','cancelled')),
    details jsonb NOT NULL,
    repaired_execution_id uuid REFERENCES gameai.executions(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(requesting_execution_id,source_task_id),
    CHECK(requesting_task_id<>source_task_id)
);
CREATE INDEX upstream_repairs_source ON gameai.upstream_repairs(source_task_id) WHERE state='open';
ALTER TABLE gameai.requirement_revisions ADD COLUMN recovery_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE gameai.requirement_revisions ADD COLUMN recovery_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE gameai.requirement_revisions ADD COLUMN recovery_execution_id text;
ALTER TABLE gameai.requirement_revisions ADD COLUMN recovery_history jsonb NOT NULL DEFAULT '[]';
ALTER TABLE gameai.requirement_revisions ADD COLUMN recovery_code text NOT NULL DEFAULT '';
ALTER TABLE gameai.pm_jobs ADD COLUMN recovery_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE gameai.pm_jobs ADD COLUMN recovery_history jsonb NOT NULL DEFAULT '[]';
ALTER TABLE gameai.pm_jobs ADD COLUMN recovery_code text NOT NULL DEFAULT '';
ALTER TABLE gameai.pm_jobs ADD COLUMN recovery_agent_id uuid REFERENCES gameai.agents(id);
GRANT SELECT ON gameai.upstream_repairs TO gameai_track;
GRANT SELECT,INSERT,UPDATE ON gameai.upstream_repairs TO gameai_workflow;
