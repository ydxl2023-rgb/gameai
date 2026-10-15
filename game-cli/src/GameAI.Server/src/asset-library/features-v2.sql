-- Source evidence is queryable independently of embeddings.
CREATE INDEX IF NOT EXISTS resource_versions_features_gin ON assets.resource_versions USING gin(descriptor jsonb_path_ops);
CREATE INDEX IF NOT EXISTS template_bindings_features_gin ON catalog.template_bindings USING gin(binding jsonb_path_ops);
CREATE INDEX IF NOT EXISTS template_versions_features_gin ON catalog.template_versions USING gin(document jsonb_path_ops);
CREATE INDEX IF NOT EXISTS resources_kind ON assets.resources(kind);
