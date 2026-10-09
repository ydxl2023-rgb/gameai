SET search_path=gameai,public;
ALTER TABLE tasks ADD COLUMN qa_source_task_id uuid REFERENCES tasks(id), ADD COLUMN bound_agent_id uuid;
ALTER TABLE tasks ADD CONSTRAINT bound_agent_project FOREIGN KEY(project_id,bound_agent_id) REFERENCES agents(project_id,id);
CREATE UNIQUE INDEX one_generated_qa_per_source ON tasks(qa_source_task_id) WHERE qa_source_task_id IS NOT NULL;
ALTER TABLE task_dispatch_jobs ADD COLUMN context jsonb NOT NULL DEFAULT '{}';
CREATE TABLE qa_defects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    qa_task_id uuid NOT NULL,
    source_task_id uuid NOT NULL,
    repair_task_id uuid NOT NULL UNIQUE,
    source_execution_id uuid NOT NULL,
    developer_agent_id uuid NOT NULL,
    qa_agent_id uuid NOT NULL,
    case_key text NOT NULL,
    details jsonb NOT NULL,
    state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','retest','closed','exhausted')),
    rounds integer NOT NULL DEFAULT 0 CHECK(rounds BETWEEN 0 AND 3),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(qa_task_id,source_task_id,case_key),
    FOREIGN KEY(project_id,qa_task_id) REFERENCES tasks(project_id,id),
    FOREIGN KEY(project_id,source_task_id) REFERENCES tasks(project_id,id),
    FOREIGN KEY(project_id,repair_task_id) REFERENCES tasks(project_id,id),
    FOREIGN KEY(project_id,source_task_id,source_execution_id) REFERENCES executions(project_id,task_id,id),
    FOREIGN KEY(project_id,developer_agent_id) REFERENCES agents(project_id,id),
    FOREIGN KEY(project_id,qa_agent_id) REFERENCES agents(project_id,id)
);
