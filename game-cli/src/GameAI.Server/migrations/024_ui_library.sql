-- Template data is independent of workflow tasks and their cleanup lifecycle.
CREATE SCHEMA IF NOT EXISTS ui_library;
CREATE TABLE ui_library.sources (
    source_key text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ui_library.templates (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_key text NOT NULL REFERENCES ui_library.sources,
    source_guid text NOT NULL,
    name text NOT NULL,
    asset_path text NOT NULL,
    category text NOT NULL DEFAULT 'unclassified',
    UNIQUE(source_key, source_guid)
);
CREATE TABLE ui_library.versions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    template_id bigint NOT NULL REFERENCES ui_library.templates,
    content_hash text NOT NULL CHECK(length(content_hash)=64),
    document jsonb NOT NULL,
    diagnostics jsonb NOT NULL,
    grade text NOT NULL CHECK(grade IN ('supported','adaptation-required','reference-only')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(template_id, content_hash)
);
CREATE TABLE ui_library.dependencies (
    version_id bigint NOT NULL REFERENCES ui_library.versions,
    alias text NOT NULL,
    target_version_id bigint NOT NULL REFERENCES ui_library.versions,
    PRIMARY KEY(version_id, alias)
);
CREATE TABLE ui_library.imports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_key text NOT NULL REFERENCES ui_library.sources,
    batch_hash text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Only the local maintenance role may write; the Track service gets read access.
GRANT USAGE ON SCHEMA ui_library TO gameai_track, gameai_workflow;
GRANT SELECT ON ALL TABLES IN SCHEMA ui_library TO gameai_track;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ui_library TO gameai_workflow;
GRANT UPDATE (name, asset_path) ON ui_library.templates TO gameai_workflow;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ui_library TO gameai_workflow;
