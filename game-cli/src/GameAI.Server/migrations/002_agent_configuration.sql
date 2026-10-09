SET LOCAL search_path=gameai,public;
ALTER TABLE agents ADD COLUMN display_name text;
UPDATE agents SET display_name=agent_key;
ALTER TABLE agents ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE agents ADD CONSTRAINT agent_name_length CHECK (length(display_name) BETWEEN 1 AND 80);
ALTER TABLE agents ADD CONSTRAINT agent_name_unique UNIQUE(project_id,display_name);
ALTER TABLE agents ADD COLUMN capacity integer NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 16);
ALTER TABLE agents ADD COLUMN creation_request_id uuid;
ALTER TABLE agents ADD COLUMN creation_payload_hash text;
ALTER TABLE agents ADD CONSTRAINT agent_creation_unique UNIQUE(project_id,creation_request_id);
CREATE TABLE skills (
    skill_key text PRIMARY KEY,
    name text NOT NULL,
    path text NOT NULL,
    role_code text REFERENCES roles(code),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE agent_skills (
    project_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    skill_key text NOT NULL REFERENCES skills(skill_key),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    is_primary boolean NOT NULL,
    PRIMARY KEY(agent_id,skill_key),
    FOREIGN KEY(project_id,agent_id) REFERENCES agents(project_id,id)
);
CREATE UNIQUE INDEX one_primary_skill ON agent_skills(agent_id) WHERE is_primary;
