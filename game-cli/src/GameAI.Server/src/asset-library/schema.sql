-- Separate database only. Track migrations must never execute this file.
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS assets;
CREATE SCHEMA IF NOT EXISTS ingestion;
CREATE SCHEMA IF NOT EXISTS search;
CREATE SCHEMA IF NOT EXISTS validation;
CREATE TABLE IF NOT EXISTS catalog.sources (
    id uuid PRIMARY KEY, source_key text UNIQUE NOT NULL,
    metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog.templates (
    id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES catalog.sources,
    source_guid text NOT NULL, name text NOT NULL, asset_path text NOT NULL,
    UNIQUE(source_id,source_guid)
);
CREATE TABLE IF NOT EXISTS catalog.template_versions (
    id uuid PRIMARY KEY, template_id uuid NOT NULL REFERENCES catalog.templates,
    content_hash text NOT NULL, document jsonb NOT NULL,
    source_snapshot jsonb NOT NULL, visual_evidence jsonb,
    quality jsonb NOT NULL, provenance jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(template_id,content_hash)
);
CREATE TABLE IF NOT EXISTS assets.blobs (
    hash text PRIMARY KEY CHECK(hash ~ '^[a-f0-9]{64}$'),
    bytes bytea NOT NULL, byte_length bigint NOT NULL CHECK(byte_length=octet_length(bytes))
);
CREATE TABLE IF NOT EXISTS assets.resources (
    id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES catalog.sources,
    source_object_key text NOT NULL, kind text NOT NULL,
    UNIQUE(source_id,source_object_key)
);
CREATE TABLE IF NOT EXISTS assets.resource_versions (
    id uuid PRIMARY KEY, resource_id uuid NOT NULL REFERENCES assets.resources,
    content_hash text NOT NULL, descriptor jsonb NOT NULL,
    blob_hash text REFERENCES assets.blobs,
    UNIQUE(resource_id,content_hash)
);
CREATE TABLE IF NOT EXISTS assets.resource_dependencies (
    version_id uuid REFERENCES assets.resource_versions,
    dependency_id uuid REFERENCES assets.resource_versions,
    PRIMARY KEY(version_id,dependency_id)
);
CREATE TABLE IF NOT EXISTS catalog.template_dependencies (
    version_id uuid REFERENCES catalog.template_versions,
    alias text NOT NULL, dependency_id uuid NOT NULL REFERENCES catalog.template_versions,
    PRIMARY KEY(version_id,alias)
);
CREATE TABLE IF NOT EXISTS catalog.template_resources (
    version_id uuid REFERENCES catalog.template_versions,
    ref_id text NOT NULL, resource_version_id uuid NOT NULL REFERENCES assets.resource_versions,
    PRIMARY KEY(version_id,ref_id)
);
CREATE TABLE IF NOT EXISTS catalog.template_bindings (
    version_id uuid REFERENCES catalog.template_versions,
    ordinal integer NOT NULL, binding jsonb NOT NULL,
    PRIMARY KEY(version_id,ordinal)
);
CREATE TABLE IF NOT EXISTS ingestion.import_batches (
    id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES catalog.sources,
    batch_hash text NOT NULL, root_guid text NOT NULL,
    result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(source_id,batch_hash,root_guid)
);
CREATE TABLE IF NOT EXISTS search.documents (
    version_id uuid PRIMARY KEY REFERENCES catalog.template_versions,
    summary text NOT NULL, content_hash text NOT NULL, metadata jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS search.embedding_profiles (
    id text PRIMARY KEY, configuration jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS search.index_jobs (
    version_id uuid REFERENCES search.documents,
    profile_id text REFERENCES search.embedding_profiles,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
    attempts integer NOT NULL DEFAULT 0, last_error text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(version_id,profile_id)
);
CREATE INDEX IF NOT EXISTS index_jobs_status ON search.index_jobs(status);
CREATE INDEX IF NOT EXISTS template_versions_template ON catalog.template_versions(template_id);
CREATE INDEX IF NOT EXISTS template_resources_resource ON catalog.template_resources(resource_version_id);
CREATE TABLE IF NOT EXISTS validation.previews (
    version_id uuid REFERENCES catalog.template_versions,
    blob_hash text REFERENCES assets.blobs,
    evidence jsonb NOT NULL,
    PRIMARY KEY(version_id,blob_hash)
);
