CREATE TABLE gameai.fixed_agents (
    project_id uuid NOT NULL REFERENCES gameai.projects(id),
    role_code text NOT NULL REFERENCES gameai.roles(code),
    agent_id uuid NOT NULL,
    PRIMARY KEY(project_id, role_code),
    FOREIGN KEY(project_id, agent_id) REFERENCES gameai.agents(project_id,id)
);
CREATE TABLE gameai.agent_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    requirement_key text NOT NULL,
    role_code text NOT NULL,
    agent_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    thread_id text,
    UNIQUE(project_id,requirement_key,role_code),
    FOREIGN KEY(project_id,agent_id) REFERENCES gameai.agents(project_id,id),
    FOREIGN KEY(project_id,worker_id) REFERENCES gameai.workers(project_id,id)
);
CREATE TABLE gameai.agent_runs (
    execution_id text PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES gameai.agent_conversations(id),
    request_hash text NOT NULL,
    state text NOT NULL CHECK(state IN ('running','completed','failed','unknown')),
    started_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '90 seconds',
    finished_at timestamptz,
    error text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX one_conversation_run ON gameai.agent_runs(conversation_id) WHERE state IN ('running','unknown');
GRANT SELECT ON gameai.fixed_agents,gameai.agent_conversations,gameai.agent_runs TO gameai_track;
