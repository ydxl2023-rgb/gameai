using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Core
{
    /// <summary>Registers all discovered professional scopes before execution approval.</summary>
    internal sealed class EarlyTaskPublisher
    {
        private readonly JiraWorkflowStore store;

        private readonly Action<string> guard;

        public EarlyTaskPublisher(JiraWorkflowStore store, Action<string> guard)
        {
            this.store = store;
            this.guard = guard;
        }

        /// <summary>Derives one scope per discovered profession with stable dependencies.</summary>
        public static PlannedTask[] BuildTasks(DesignBrief design)
        {
            List<PlannedTask> tasks = new();
            string title = design.Title[..Math.Min(185, design.Title.Length)];
            if (design.ArtRequirements.Length > 0)
            {
                tasks.Add(EarlyArtPublisher.BuildTask(design));
            }

            if (design.DevelopmentRequirements.Length > 0)
            {
                string description = "平台：移动端触屏操作。\n" + design.Specification + "\n" + string.Join("\n", design.DevelopmentRequirements);
                WorkflowContract.RequireText(description, 6000);
                tasks.Add(new PlannedTask("development-requirements", "Development", "功能开发：" + title, description, design.Acceptance, tasks.Select(task => task.Id).ToArray()));
            }

            if (design.Acceptance.Length > 0)
            {
                string description = "平台：移动端触屏操作。\n依据本单据测试用例验证需求并记录实际结果。\n" + design.Specification;
                WorkflowContract.RequireText(description, 6000);
                tasks.Add(new PlannedTask("qa-requirements", "QA", "测试验收：" + title, description, design.Acceptance, tasks.Select(task => task.Id).ToArray()));
            }

            return tasks.ToArray();
        }

        /// <summary>Reuses existing issues and reconciles each uncertain POST independently.</summary>
        public async Task PublishAsync(Workflow state, CancellationToken cancellation)
        {
            if (state.Design == null)
            {
                return;
            }

            PlannedTask[] tasks = BuildTasks(state.Design);
            await new EarlyArtPublisher(store, guard).PublishAsync(state, cancellation);
            foreach (PlannedTask task in tasks.Where(task => task.Role != "Art"))
            {
                guard("pm");
                MobileRequirementPolicy.Validate(state.Design);
                Workflow current = await store.LoadAsync(state.IssueKey, cancellation);
                if (current.Revision != state.Revision || current.DocumentHash != state.DocumentHash)
                {
                    throw new JiraTaskException("Design changed before task registration. Reload JIRA.", 3);
                }

                EarlyTaskPublication? publication = state.EarlyTasks.SingleOrDefault(item => item.Task.Id == task.Id);
                if (publication == null)
                {
                    publication = new EarlyTaskPublication
                    {
                        Task = task
                    };
                    state.EarlyTasks.Add(publication);
                }

                publication.Task = task;
                publication.Created ??= await store.FindTaskAsync(state, task, cancellation);
                if (publication.Created == null && publication.Pending)
                {
                    throw new JiraTaskException("Task registration outcome is unknown for " + task.Id + ". No second POST was sent.", 3, true);
                }

                if (publication.Created == null)
                {
                    publication.Pending = true;
                    await store.SaveAsync(state, cancellation);
                    try
                    {
                        publication.Created = await store.CreateTaskAsync(state, task, cancellation);
                    }
                    catch (JiraTaskException exception) when (!exception.OutcomeUnknown)
                    {
                        publication.Pending = false;
                        await store.SaveAsync(state, cancellation);
                        throw;
                    }
                }

                await store.UpdateTaskAsync(state, task, publication.Created, cancellation);
                publication.Pending = false;
                await store.SaveAsync(state, cancellation);
            }
        }

        /// <summary>Includes legacy art registration when enumerating verified early issues.</summary>
        public static IEnumerable<CreatedTask> Created(Workflow state)
        {
            if (state.ArtCreated != null && state.Design!.ArtRequirements.Length > 0)
            {
                yield return state.ArtCreated;
            }

            foreach (EarlyTaskPublication publication in state.EarlyTasks)
            {
                if (publication.Created != null)
                {
                    yield return publication.Created;
                }
            }
        }
    }
}
