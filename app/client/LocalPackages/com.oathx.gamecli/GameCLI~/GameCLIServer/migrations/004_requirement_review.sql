CREATE TABLE gameai.document_contents (
    artifact_id uuid PRIMARY KEY REFERENCES gameai.artifacts(id),
    bytes bytea NOT NULL
);
CREATE TRIGGER immutable_document BEFORE UPDATE OR DELETE ON gameai.document_contents
    FOR EACH ROW EXECUTE FUNCTION gameai.deny_change();
CREATE TABLE gameai.human_credentials (
    user_id uuid PRIMARY KEY REFERENCES gameai.users(id),
    password_hash text NOT NULL
);
