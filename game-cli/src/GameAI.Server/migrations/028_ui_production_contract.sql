CREATE TABLE gameai.ui_production_contracts (
    project_id uuid NOT NULL REFERENCES gameai.projects(id),
    contract_id uuid NOT NULL,
    version integer NOT NULL CHECK(version>0),
    requirement_version_id uuid NOT NULL,
    sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
    document_sha256 text NOT NULL,
    content jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(project_id,contract_id,version),
    FOREIGN KEY(project_id,requirement_version_id) REFERENCES gameai.requirement_versions(project_id,id)
);
CREATE TRIGGER immutable_ui_contract BEFORE UPDATE ON gameai.ui_production_contracts
    FOR EACH ROW EXECUTE FUNCTION gameai.deny_change();
CREATE TABLE gameai.ui_task_plan_requests (
    project_id uuid NOT NULL REFERENCES gameai.projects(id),
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    parent_task_id uuid NOT NULL REFERENCES gameai.tasks(id) ON DELETE CASCADE,
    result jsonb NOT NULL,
    PRIMARY KEY(project_id,request_id)
);
CREATE TABLE gameai.ui_task_contracts (
    task_id uuid PRIMARY KEY REFERENCES gameai.tasks(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES gameai.projects(id),
    contract_id uuid NOT NULL,
    contract_version integer NOT NULL,
    contract_hash text NOT NULL,
    input_hash text NOT NULL,
    input jsonb NOT NULL,
    FOREIGN KEY(project_id,contract_id,contract_version) REFERENCES gameai.ui_production_contracts(project_id,contract_id,version)
);
CREATE TRIGGER immutable_ui_task_input BEFORE UPDATE ON gameai.ui_task_contracts
    FOR EACH ROW EXECUTE FUNCTION gameai.deny_change();
GRANT SELECT,INSERT,DELETE ON gameai.ui_production_contracts,gameai.ui_task_plan_requests,gameai.ui_task_contracts TO gameai_track;
