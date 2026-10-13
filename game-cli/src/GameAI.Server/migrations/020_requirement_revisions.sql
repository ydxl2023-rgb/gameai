SET search_path=gameai,public;
ALTER TABLE pm_jobs DROP CONSTRAINT pm_jobs_state_check;
ALTER TABLE pm_jobs ADD CONSTRAINT pm_jobs_state_check CHECK(state IN ('running','completed','failed','unknown','revision_required'));
CREATE TABLE requirement_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    source_version_id uuid NOT NULL UNIQUE REFERENCES requirement_versions(id),
    pm_job_id uuid NOT NULL REFERENCES pm_jobs(id),
    design_agent_id uuid REFERENCES agents(id),
    report jsonb NOT NULL,
    fingerprint text NOT NULL,
    round integer NOT NULL,
    target_version text NOT NULL,
    state text NOT NULL CHECK(state IN ('queued','running','awaiting_approval','needs_input','failed','superseded','unknown')),
    error text NOT NULL DEFAULT '',
    new_version_id uuid REFERENCES requirement_versions(id),
    submission jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
);
GRANT SELECT ON requirement_revisions TO gameai_track;
GRANT SELECT,INSERT,UPDATE,DELETE ON requirement_revisions TO gameai_workflow;
