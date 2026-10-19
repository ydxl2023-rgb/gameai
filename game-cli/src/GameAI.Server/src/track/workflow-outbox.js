// Events are durable wakeups, never dispatch authorization. The consumer checks the current flow.
export async function drainWorkflowOutbox(pool,continueFlow)
{
    const events=(await pool.query(`SELECT event_key,plan_version_id FROM gameai.workflow_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 100`)).rows;
    for (const event of events)
    {
        await continueFlow(pool,event.plan_version_id);
        await pool.query('UPDATE gameai.workflow_outbox SET delivered_at=now() WHERE event_key=$1 AND delivered_at IS NULL',[event.event_key]);
    }
}
