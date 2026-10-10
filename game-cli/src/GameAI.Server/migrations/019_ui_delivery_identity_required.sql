-- SQL CHECK treats NULL as success; all three identity fields must be present together.
ALTER TABLE gameai.tasks DROP CONSTRAINT task_delivery_identity;
ALTER TABLE gameai.tasks ADD CONSTRAINT task_delivery_identity CHECK (
    (logical_id IS NULL AND window_id IS NULL AND delivery_phase IS NULL) OR
    (logical_id IS NOT NULL AND window_id IS NOT NULL AND delivery_phase IS NOT NULL
        AND delivery_phase IN ('whitebox','art','assembly'))
);
