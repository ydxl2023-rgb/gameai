-- Task HTML publication uses an idempotent upsert that preserves verified_at.
-- PostgreSQL checks the UPDATE privilege even when the INSERT has no conflict.
-- Do not allow the workflow role to rewrite artifact bytes, hashes or paths.
GRANT UPDATE (verified_at) ON gameai.artifacts TO gameai_workflow;
