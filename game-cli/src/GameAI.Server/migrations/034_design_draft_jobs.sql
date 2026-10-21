-- Initial Design drafts have a durable owner before any Agent process starts.
CREATE TABLE gameai.design_draft_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES gameai.projects(id),
    request_id uuid NOT NULL,
    input_hash text NOT NULL,
    input jsonb NOT NULL,
    design_agent_id uuid NOT NULL REFERENCES gameai.agents(id),
    state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','failed','unknown','needs_input','attention','completed','cancelled')),
    attempts integer NOT NULL DEFAULT 0,
    execution_id text,
    history jsonb NOT NULL DEFAULT '[]',
    submission jsonb,
    receipt jsonb,
    error text NOT NULL DEFAULT '',
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id,request_id)
);
CREATE UNIQUE INDEX design_draft_target ON gameai.design_draft_jobs(project_id,(input->>'requirement_key'),(input->>'version'));
GRANT SELECT ON gameai.design_draft_jobs TO gameai_track;
GRANT SELECT,INSERT,UPDATE ON gameai.design_draft_jobs TO gameai_workflow;
