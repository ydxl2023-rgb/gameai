SET search_path=gameai,public;
CREATE TABLE plan_dispatch_flows (
    plan_version_id uuid PRIMARY KEY REFERENCES plan_versions(id),
    project_id uuid NOT NULL REFERENCES projects(id),
    requested_by uuid NOT NULL REFERENCES users(id),
    state text NOT NULL CHECK(state IN ('active','paused','completed')),
    reason text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
