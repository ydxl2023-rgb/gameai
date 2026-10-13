CREATE TABLE ui_library.visual_blobs (
    hash text PRIMARY KEY,
    bytes bytea NOT NULL,
    byte_length bigint NOT NULL CHECK(byte_length = octet_length(bytes))
);
CREATE TABLE ui_library.visual_resources (
    version_id bigint NOT NULL REFERENCES ui_library.versions,
    resource_id text NOT NULL,
    kind text NOT NULL,
    descriptor jsonb NOT NULL,
    blob_hash text REFERENCES ui_library.visual_blobs,
    PRIMARY KEY(version_id, resource_id)
);
CREATE TABLE ui_library.visual_bindings (
    version_id bigint PRIMARY KEY REFERENCES ui_library.versions,
    document jsonb NOT NULL
);
CREATE INDEX visual_resources_kind ON ui_library.visual_resources(kind);
CREATE INDEX visual_resources_search ON ui_library.visual_resources USING gin(descriptor);
COMMENT ON TABLE ui_library.visual_resources IS 'Immutable per-prefab visual graph. Dependency IDs resolve within the same version_id, including cycles.';
GRANT SELECT ON ui_library.visual_blobs, ui_library.visual_resources, ui_library.visual_bindings TO gameai_track;
GRANT SELECT, INSERT ON ui_library.visual_blobs, ui_library.visual_resources, ui_library.visual_bindings TO gameai_workflow;
