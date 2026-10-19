-- Opt in new executions only; historical failures must not be replayed on deployment.
ALTER TABLE gameai.pm_jobs ADD COLUMN recover_publication boolean NOT NULL DEFAULT false;
ALTER TABLE gameai.pm_jobs ADD COLUMN publication_result jsonb;
ALTER TABLE gameai.pm_jobs ADD COLUMN publication_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE gameai.pm_jobs ADD COLUMN publication_retry_at timestamptz NOT NULL DEFAULT now();
