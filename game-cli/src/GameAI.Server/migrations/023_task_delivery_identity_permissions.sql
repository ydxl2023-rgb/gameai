-- PM publication binds each inserted task to the validated UI delivery skeleton.
GRANT UPDATE (logical_id,window_id,delivery_phase) ON gameai.tasks TO gameai_workflow;
