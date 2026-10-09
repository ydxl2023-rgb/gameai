SET search_path=gameai,public;
ALTER TABLE agents ADD COLUMN auto_execute boolean NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN automation_revision integer NOT NULL DEFAULT 0;
ALTER TABLE approval_workflows ADD COLUMN agent_policy jsonb;
ALTER TABLE approval_workflows DROP CONSTRAINT approval_workflows_state_check;
ALTER TABLE approval_workflows ADD CONSTRAINT approval_workflows_state_check CHECK(state IN ('queued','manual_pm','pm','dispatched','failed'));
ALTER TABLE plan_dispatch_flows ADD COLUMN agent_policy jsonb;
