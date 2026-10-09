-- One schema owns the new platform; legacy JIRA storage is deliberately separate.
CREATE SCHEMA gameai;
SET LOCAL search_path = gameai, public;

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_key text NOT NULL UNIQUE,
    name text NOT NULL,
    is_test boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject text NOT NULL UNIQUE,
    display_name text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE roles (code text PRIMARY KEY);
INSERT INTO roles VALUES ('Design'), ('PM'), ('Art'), ('Development'), ('QA'), ('Admin');
CREATE TABLE permissions (code text PRIMARY KEY);
INSERT INTO permissions VALUES ('project.read'), ('requirement.approve'), ('project.manage'), ('task.write_assigned');
CREATE TABLE role_permissions (
    role_code text REFERENCES roles(code),
    permission_code text REFERENCES permissions(code),
    PRIMARY KEY (role_code, permission_code)
);
INSERT INTO role_permissions SELECT code, 'project.read' FROM roles;
INSERT INTO role_permissions VALUES ('Design', 'requirement.approve'), ('Admin', 'project.manage');
CREATE TABLE user_roles (
    project_id uuid REFERENCES projects(id),
    user_id uuid REFERENCES users(id),
    role_code text REFERENCES roles(code),
    PRIMARY KEY (project_id, user_id, role_code)
);
CREATE TABLE workers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    worker_key text NOT NULL,
    name text NOT NULL,
    capacity integer NOT NULL CHECK (capacity > 0),
    last_heartbeat_at timestamptz,
    enabled boolean NOT NULL DEFAULT false,
    UNIQUE (project_id, worker_key), UNIQUE (project_id, id)
);
CREATE TABLE agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    agent_key text NOT NULL,
    role_code text NOT NULL REFERENCES roles(code) CHECK (role_code <> 'Admin'),
    worker_id uuid NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    UNIQUE (project_id, agent_key), UNIQUE (project_id, id),
    FOREIGN KEY (project_id, worker_id) REFERENCES workers(project_id, id)
);
CREATE TABLE agent_grants (
    project_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    permission_code text NOT NULL REFERENCES permissions(code)
        CHECK (permission_code IN ('project.read', 'task.write_assigned')),
    PRIMARY KEY (agent_id, permission_code),
    FOREIGN KEY (project_id, agent_id) REFERENCES agents(project_id, id)
);
CREATE TABLE requirements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    requirement_key text NOT NULL,
    title text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, requirement_key), UNIQUE (project_id, id)
);
CREATE TABLE requirement_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    requirement_id uuid NOT NULL,
    version text NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal > 0),
    content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (requirement_id, version), UNIQUE (requirement_id, ordinal), UNIQUE (project_id, id),
    FOREIGN KEY (project_id, requirement_id) REFERENCES requirements(project_id, id)
);
CREATE FUNCTION deny_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Immutable record; append a new version or event';
END $$;
CREATE TRIGGER immutable_requirement_version BEFORE UPDATE OR DELETE ON requirement_versions
    FOR EACH ROW EXECUTE FUNCTION deny_change();
CREATE TABLE approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    version_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id),
    decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (version_id),
    FOREIGN KEY (project_id, version_id) REFERENCES requirement_versions(project_id, id)
);
CREATE FUNCTION guard_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
        JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code
        WHERE u.id=NEW.user_id AND u.enabled AND ur.project_id=NEW.project_id
        AND rp.permission_code='requirement.approve') THEN
        RAISE EXCEPTION 'Enabled human approver required';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER human_approval BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION guard_approval();
CREATE TRIGGER immutable_approval BEFORE UPDATE OR DELETE ON approvals FOR EACH ROW EXECUTE FUNCTION deny_change();
CREATE TABLE plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    requirement_id uuid NOT NULL,
    UNIQUE (project_id, id),
    FOREIGN KEY (project_id, requirement_id) REFERENCES requirements(project_id, id)
);
CREATE TABLE plan_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    requirement_version_id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'superseded')),
    UNIQUE (plan_id, version), UNIQUE (project_id, id),
    FOREIGN KEY (project_id, plan_id) REFERENCES plans(project_id, id),
    FOREIGN KEY (project_id, requirement_version_id) REFERENCES requirement_versions(project_id, id)
);
CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    task_key text NOT NULL,
    plan_version_id uuid NOT NULL,
    title text NOT NULL,
    role_code text NOT NULL REFERENCES roles(code) CHECK (role_code <> 'Admin'),
    delivery_criteria jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(delivery_criteria) = 'array'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','blocked','running','review','completed','failed','cancelled')),
    progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, task_key), UNIQUE (project_id, id),
    FOREIGN KEY (project_id, plan_version_id) REFERENCES plan_versions(project_id, id)
);
CREATE TABLE task_dependencies (
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    depends_on_id uuid NOT NULL,
    PRIMARY KEY (task_id, depends_on_id), CHECK (task_id <> depends_on_id),
    FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
    FOREIGN KEY (project_id, depends_on_id) REFERENCES tasks(project_id, id)
);
-- Serialize graph edits per project, including concurrent transactions.
CREATE FUNCTION guard_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text, 0));
    IF EXISTS (WITH RECURSIVE edges(id) AS (
        SELECT NEW.depends_on_id UNION
        SELECT d.depends_on_id FROM gameai.task_dependencies d JOIN edges e ON d.task_id=e.id
    ) SELECT 1 FROM edges WHERE id=NEW.task_id) THEN
        RAISE EXCEPTION 'Task dependency cycle';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER acyclic_dependency BEFORE INSERT OR UPDATE ON task_dependencies FOR EACH ROW EXECUTE FUNCTION guard_dependency();
CREATE TABLE executions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    state text NOT NULL CHECK (state IN ('assigned','running','succeeded','failed','cancelled','unknown')),
    result jsonb,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    UNIQUE (project_id, id), UNIQUE (project_id, task_id, id),
    FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
    FOREIGN KEY (project_id, agent_id) REFERENCES agents(project_id, id)
);
CREATE UNIQUE INDEX one_active_execution ON executions(task_id) WHERE state IN ('assigned','running','unknown');
CREATE TABLE task_leases (
    project_id uuid NOT NULL,
    task_id uuid PRIMARY KEY,
    execution_id uuid NOT NULL UNIQUE,
    epoch bigint NOT NULL CHECK (epoch > 0),
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (project_id, task_id, execution_id) REFERENCES executions(project_id, task_id, id)
);
CREATE TABLE artifacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    storage_key text NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    media_type text NOT NULL,
    verified_at timestamptz,
    UNIQUE (project_id, storage_key), UNIQUE (project_id, id)
);
CREATE TABLE artifact_links (
    project_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    requirement_version_id uuid,
    task_id uuid,
    CHECK (num_nonnulls(requirement_version_id, task_id) = 1),
    UNIQUE NULLS NOT DISTINCT (artifact_id, requirement_version_id, task_id),
    FOREIGN KEY (project_id, artifact_id) REFERENCES artifacts(project_id, id),
    FOREIGN KEY (project_id, requirement_version_id) REFERENCES requirement_versions(project_id, id),
    FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id)
);
CREATE TABLE comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    execution_id uuid,
    user_id uuid REFERENCES users(id),
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(execution_id, user_id) = 1),
    FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
    FOREIGN KEY (project_id, task_id, execution_id) REFERENCES executions(project_id, task_id, id)
);
CREATE TABLE audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id),
    actor text NOT NULL,
    event text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_change();
CREATE TABLE idempotency_records (
    scope text NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);
CREATE TABLE outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX pending_outbox ON outbox_events(created_at) WHERE delivered_at IS NULL;
CREATE INDEX tasks_status ON tasks(project_id, status);
CREATE INDEX audit_project_time ON audit_events(project_id, created_at DESC);
CREATE INDEX dependency_reverse ON task_dependencies(depends_on_id);
