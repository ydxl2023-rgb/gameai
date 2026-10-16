// Each lane is single-flight. A long Agent run must not starve other workflow lanes.
export function createWorkflowPump(lanes, onError)
{
    const running = new Set();
    return async function tick()
    {
        await Promise.all(Object.entries(lanes).map(async ([name, run]) =>
        {
            if (running.has(name))
            {
                return;
            }
            running.add(name);
            try
            {
                await run();
            }
            catch (error)
            {
                onError(name, error);
            }
            finally
            {
                running.delete(name);
            }
        }));
    };
}
