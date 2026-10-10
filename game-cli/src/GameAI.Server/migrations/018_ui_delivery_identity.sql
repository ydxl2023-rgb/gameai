-- Logical identities survive model wording changes; public task keys remain database allocated.
ALTER TABLE gameai.tasks ADD COLUMN logical_id text;
ALTER TABLE gameai.tasks ADD COLUMN window_id text;
ALTER TABLE gameai.tasks ADD COLUMN delivery_phase text;
ALTER TABLE gameai.tasks ADD CONSTRAINT task_delivery_identity CHECK (
    (logical_id IS NULL AND window_id IS NULL AND delivery_phase IS NULL) OR
    (logical_id IS NOT NULL AND window_id IS NOT NULL AND delivery_phase IN ('whitebox','art','assembly'))
);
CREATE UNIQUE INDEX task_plan_logical_identity ON gameai.tasks(plan_version_id,logical_id) WHERE logical_id IS NOT NULL;
