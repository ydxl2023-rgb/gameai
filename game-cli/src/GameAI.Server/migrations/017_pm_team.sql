-- Preserve existing conversations while isolating team members within the PM role.
ALTER TABLE gameai.agent_conversations DROP CONSTRAINT agent_conversations_project_id_requirement_key_role_code_key;
ALTER TABLE gameai.agent_conversations ADD CONSTRAINT member_conversation_unique UNIQUE(project_id,requirement_key,agent_id);
CREATE TABLE gameai.pm_stages (
    execution_id text PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES gameai.pm_jobs(id) ON DELETE CASCADE,
    parent_execution_id text NOT NULL,
    agent_id uuid NOT NULL REFERENCES gameai.agents(id),
    stage text NOT NULL,
    input_hash text NOT NULL,
    state text NOT NULL CHECK(state IN ('running','completed','failed')),
    result jsonb,
    UNIQUE(parent_execution_id,stage)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON gameai.pm_stages TO gameai_workflow;
