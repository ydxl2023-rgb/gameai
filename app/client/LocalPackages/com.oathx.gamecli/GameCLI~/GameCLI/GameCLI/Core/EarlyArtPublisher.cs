using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Core
{
    /// <summary>Registers art scope immediately after design without authorizing asset production.</summary>
    internal sealed class EarlyArtPublisher
    {
        private readonly JiraWorkflowStore store;

        private readonly Action<string> guard;

        public EarlyArtPublisher(JiraWorkflowStore store, Action<string> guard)
        {
            this.store = store;
            this.guard = guard;
        }

        /// <summary>Builds one art scope issue which PM must reuse unchanged in its complete plan.</summary>
        public static PlannedTask BuildTask(DesignBrief design)
        {
            string description = "平台：移动端触屏操作。\n" + string.Join("\n", design.ArtRequirements);
            WorkflowContract.RequireText(description, 6000);
            string[] acceptance = design.ArtRequirements.Select(item => "用例名称：资源交付检查\n前置条件：对应资源已提交\n操作步骤：检查以下资源要求\n预期结果：" + item).ToArray();
            foreach (string item in acceptance)
            {
                WorkflowContract.RequireText(item, 1000);
            }

            return new PlannedTask("art-requirements", "Art", "需求资源：" + design.Title[..Math.Min(190, design.Title.Length)], description, acceptance, Array.Empty<string>());
        }

        /// <summary>Reconciles saved intent before POST and retains it if the outcome is unknown.</summary>
        public async Task PublishAsync(Workflow state, CancellationToken cancellation)
        {
            if (state.Design == null)
            {
                return;
            }

            if (state.Design.ArtRequirements.Length == 0 && state.ArtCreated == null && !state.ArtPending)
            {
                return;
            }

            guard("pm");
            MobileRequirementPolicy.Validate(state.Design);
            Workflow current = await store.LoadAsync(state.IssueKey, cancellation);
            if (current.Revision != state.Revision || current.DocumentHash != state.DocumentHash)
            {
                throw new JiraTaskException("Design changed before art publication. Reload JIRA.", 3);
            }

            // Revisions update the same art scope issue; unresolved POSTs must be reconciled first.
            state.ArtTask = state.Design.ArtRequirements.Length > 0 ? BuildTask(state.Design) : state.ArtTask;
            state.ArtCreated ??= await store.FindTaskAsync(state, state.ArtTask!, cancellation);
            if (state.ArtCreated == null && state.ArtPending)
            {
                throw new JiraTaskException("Art creation outcome is unknown. Check JIRA before resuming; no second POST was sent.", 3, true);
            }

            if (state.ArtCreated == null)
            {
                state.ArtPending = true;
                await store.SaveAsync(state, cancellation);
                try
                {
                    state.ArtCreated = await store.CreateTaskAsync(state, state.ArtTask!, cancellation);
                }
                catch (JiraTaskException exception) when (!exception.OutcomeUnknown)
                {
                    state.ArtPending = false;
                    await store.SaveAsync(state, cancellation);
                    throw;
                }
            }

            await store.UpdateArtAsync(state, cancellation);
            state.ArtPending = false;
            await store.SaveAsync(state, cancellation);
        }
    }
}
