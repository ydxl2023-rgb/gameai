CREATE TABLE gameai.requirement_rule_snapshots (
    version_id uuid PRIMARY KEY REFERENCES gameai.requirement_versions(id) ON DELETE CASCADE,
    sha256 text NOT NULL,
    content jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_requirement_rules BEFORE UPDATE ON gameai.requirement_rule_snapshots
    FOR EACH ROW EXECUTE FUNCTION gameai.deny_change();
GRANT SELECT ON gameai.requirement_rule_snapshots TO gameai_track;
