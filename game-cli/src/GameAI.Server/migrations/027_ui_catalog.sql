CREATE TABLE ui_library.catalog (
    version_id bigint PRIMARY KEY REFERENCES ui_library.versions,
    index_version integer NOT NULL,
    summary jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ui_library.previews (
    version_id bigint PRIMARY KEY REFERENCES ui_library.versions,
    image bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_summary ON ui_library.catalog USING gin(summary);
GRANT SELECT ON ui_library.catalog, ui_library.previews TO gameai_track;
GRANT SELECT, INSERT, UPDATE ON ui_library.catalog, ui_library.previews TO gameai_workflow;
