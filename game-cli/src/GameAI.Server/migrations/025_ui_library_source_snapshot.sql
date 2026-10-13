ALTER TABLE ui_library.versions ADD COLUMN source_revision text NOT NULL DEFAULT '';
ALTER TABLE ui_library.versions ADD COLUMN extraction_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
