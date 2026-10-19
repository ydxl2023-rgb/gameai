-- Execution input and received output survive server restarts. No model can write this queue.
CREATE TABLE gameai.task_publications (
    execution_id uuid PRIMARY KEY REFERENCES gameai.executions(id) ON DELETE CASCADE,
    job jsonb NOT NULL,
    state text NOT NULL DEFAULT 'executing' CHECK(state IN ('executing','ready','published','attention')),
    response jsonb,
    attempts integer NOT NULL DEFAULT 0,
    last_error text NOT NULL DEFAULT '',
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_publications_pending ON gameai.task_publications(next_attempt_at) WHERE state IN ('executing','ready');
GRANT SELECT ON gameai.task_publications TO gameai_track;
CREATE TABLE gameai.workflow_outbox (
    event_key text PRIMARY KEY,
    plan_version_id uuid NOT NULL REFERENCES gameai.plan_versions(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);
GRANT SELECT ON gameai.workflow_outbox TO gameai_track;
