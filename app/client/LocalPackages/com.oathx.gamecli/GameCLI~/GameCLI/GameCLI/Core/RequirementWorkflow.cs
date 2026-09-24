using System.Text.Json;

using GameCLI.Agents;
using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Core
{
    /// <summary>Coordinates Design, human approval and PM publication using JIRA snapshots.</summary>
    internal sealed class RequirementWorkflow
    {
        private readonly JiraWorkflowStore store;

        private readonly IWorkflowAgent agent;

        private readonly Action<string> guard;

        public RequirementWorkflow(JiraWorkflowStore store, IWorkflowAgent agent, Action<string> guard)
        {
            this.store = store;
            this.agent = agent;
            this.guard = guard;
        }

        /// <summary>Registers or reuses a document workflow, then runs Design only when analysis is pending.</summary>
        public async Task<Workflow> StartAsync(string document, CancellationToken cancellation)
        {
            guard("design");
            Workflow state = await store.StartAsync(document, cancellation);
            return state.Stage == "design_pending" ? await AnalyzeAsync(state, cancellation) : state;
        }

        /// <summary>Replaces an unplanned requirement and invalidates its previous approval before rerunning Design.</summary>
        public async Task<Workflow> ReviseAsync(string key, string document, CancellationToken cancellation)
        {
            Workflow state = await store.LoadAsync(key, cancellation);
            if (state.Plan != null || state.Created.Count > 0 || state.PendingTask != null || state.ArtPending || state.EarlyTasks.Any(item => item.Pending))
            {
                throw new JiraTaskException("Tasks are already planned or published. Start a separate change workflow instead of replacing their approved requirement.", 3);
            }

            state.Document = document;
            state.DocumentHash = WorkflowContract.Hash(document);
            state.Design = null;
            state.Attachment = null;
            state.SuggestedRules = Array.Empty<string>();
            state.Revision = "";
            state.ApprovedRevision = null;
            state.ApprovedBy = null;
            state.ApprovedAt = null;
            state.Stage = "design_pending";
            await store.SaveAsync(state, cancellation);
            return await AnalyzeAsync(state, cancellation);
        }

        /// <summary>Records the caller-confirmed exact revision under the authenticated JIRA identity before starting PM.</summary>
        public async Task<Workflow> ApproveAsync(string key, string revision, CancellationToken cancellation, string? attachmentPath = null)
        {
            Workflow state = await store.LoadAsync(key, cancellation);
            if (state.Stage != "awaiting_approval" || state.Design == null || state.Design.Questions.Length > 0 || revision != state.Revision || revision != Revision(state))
            {
                throw new JiraTaskException("Approval requires the current reviewed revision with no unresolved questions. Use --status or --revise first.", 3);
            }

            state.Attachment = await JiraWorkflowStore.PrepareAttachmentAsync(revision, attachmentPath, cancellation);
            state.ApprovedBy = await store.CurrentUserAsync(cancellation);
            state.ApprovedAt = DateTimeOffset.UtcNow;
            state.ApprovedRevision = revision;
            state.Stage = "attachment_pending";
            await store.SaveAsync(state, cancellation);
            await store.EnsureAttachmentAsync(state, attachmentPath, cancellation);
            return await PublishAsync(state, cancellation);
        }

        /// <summary>Resumes an interrupted phase while preserving approval and unknown-write guards.</summary>
        public async Task<Workflow> ResumeAsync(string key, CancellationToken cancellation, string? attachmentPath = null)
        {
            Workflow state = await store.LoadAsync(key, cancellation);
            if (state.Stage is "awaiting_approval" or "needs_clarification")
            {
                // Discussion and repeated status checks must never publish professional tasks.
                return state;
            }

            if (state.Stage is "design_pending" or "design_running" or "design_failed")
            {
                return await AnalyzeAsync(state, cancellation);
            }

            if (state.Stage is "attachment_pending" or "attachment_failed")
            {
                RequireApproved(state);
                await store.EnsureAttachmentAsync(state, attachmentPath, cancellation);
                return await PublishAsync(state, cancellation);
            }

            if (state.Stage is "pm_pending" or "pm_running" or "pm_failed" or "publishing" or "outcome_unknown")
            {
                return await PublishAsync(state, cancellation);
            }

            return state;
        }

        /// <summary>Refines only unstarted tasks, preserving original identities and the approved requirement.</summary>
        public async Task<Workflow> ReplanAsync(string key, CancellationToken cancellation)
        {
            Workflow state = await store.LoadAsync(key, cancellation);
            RequireApproved(state);
            await store.VerifyAttachmentAsync(state, cancellation);
            if (state.Stage != "tasks_created" || state.Plan == null || state.PendingTask != null || state.PreviousPlan != null)
            {
                throw new JiraTaskException("仅支持对尚未迁移且已完成建单的计划重新拆分；中断后使用 resume。", 3);
            }

            foreach (CreatedTask created in state.Created)
            {
                await store.RequireUnstartedAsync(created.Key, cancellation);
            }

            state.PreviousPlan = state.Plan;
            state.Replanning = true;
            state.Stage = "pm_pending";
            await store.SaveAsync(state, cancellation);
            return await PublishAsync(state, cancellation);
        }
        private async Task<Workflow> AnalyzeAsync(Workflow state, CancellationToken cancellation)
        {
            guard("design");
            AgentExecution execution = await BeginExecutionAsync(state, "Design", "design_running", cancellation);
            try
            {
                string result = await agent.RunAsync("Design", WorkflowContract.Serialize(new
                {
                    issue_key = state.IssueKey,
                    document = state.Document
                }), WorkflowContract.DesignSchema, execution.ExecutionId, null, (thread, turn, token) => SetSessionAsync(state, execution, thread, turn, token), cancellation);
                DesignBrief design = WorkflowContract.Parse<DesignBrief>(result);
                WorkflowContract.ValidateDesign(design);
                MobileRequirementPolicy.Validate(design);
                state.Design = design;
                state.Revision = Revision(state);
                state.Stage = design.Questions.Length > 0 ? "needs_clarification" : "awaiting_approval";
                CompleteExecution(state, execution, "completed");
                await store.SaveAsync(state, cancellation);
            }
            catch
            {
                await RecordFailureAsync(state, execution, "design_failed");
                throw;
            }

            return state;
        }

        private async Task<Workflow> PublishAsync(Workflow state, CancellationToken cancellation)
        {
            RequireApproved(state);
            await store.VerifyAttachmentAsync(state, cancellation);
            guard("pm");
            AgentExecution execution = await BeginExecutionAsync(state, "PM", "pm_running", cancellation);
            try
            {
                object schema = WorkflowContract.ObjectSchema(new()
                {
                    ["status"] = new
                    {
                        type = "string",
                        @enum = new[]
                        {
                            "success",
                            "blocked"
                        }
                    },
                    ["summary"] = WorkflowContract.Text
                });
                string input = WorkflowContract.Serialize(new
                {
                    issue_key = state.IssueKey,
                    revision = state.Revision,
                    design = state.Design,
                    requirement_attachment = state.Attachment,
                    saved_plan = state.Replanning ? null : state.Plan,
                    existing_art_task = state.Design!.ArtRequirements.Length > 0 ? state.ArtTask : null,
                    existing_art_issue = state.ArtCreated,
                    existing_tasks = state.Replanning ? state.PreviousPlan!.Tasks : Array.Empty<PlannedTask>(),
                    replan = state.Replanning,
                    planning_instruction = "按 PM 技能的交付标准拆分，允许同角色多项。重新拆分时保留已有任务 ID 和角色，将其收窄为对应的一项交付并新增其余任务；按拓扑顺序提交。每项 description 标明来源、交付物和启动条件，acceptance 给出可执行验收用例。",
                    existing_issues = state.Created.Concat(EarlyTaskPublisher.Created(state)).DistinctBy(item => item.Id).ToArray(),
                    created = state.Created
                });
                bool toolSucceeded = false;
                string result = await agent.RunAsync("PM", input, schema, execution.ExecutionId, async (arguments, token) =>
                {
                    Workflow current = await store.LoadAsync(state.IssueKey, token);
                    RequireApproved(current);
                    await store.VerifyAttachmentAsync(current, token);
                    if (current.Revision != state.Revision || current.Executions.LastOrDefault()?.ExecutionId != execution.ExecutionId)
                    {
                        throw new JiraTaskException("Workflow changed during PM execution. Stop and reload JIRA.", 3);
                    }

                    guard("pm");
                    TaskPlan plan = WorkflowContract.Parse<TaskPlan>(arguments.GetRawText());
                    WorkflowContract.ValidatePlan(plan, state.Design!);
                    MobileRequirementPolicy.Validate(plan);
                    if (!state.Replanning && state.Plan != null && WorkflowContract.Serialize(state.Plan) != WorkflowContract.Serialize(plan))
                    {
                        throw new JiraTaskException("Resume must use the saved task plan unchanged.", 3);
                    }

                    if (state.Replanning)
                    {
                        foreach (CreatedTask created in state.Created)
                        {
                            PlannedTask original = state.PreviousPlan!.Tasks.Single(task => task.Id == created.Id);
                            if (!plan.Tasks.Any(task => task.Id == original.Id && task.Role == original.Role))
                            {
                                throw new JiraTaskException("重新拆分必须保留已有任务 ID 及负责角色。", 4);
                            }

                            await store.RequireUnstartedAsync(created.Key, token);
                        }
                    }

                    HashSet<string> preceding = new();
                    foreach (PlannedTask task in plan.Tasks)
                    {
                        if (task.DependsOn.Any(id => !preceding.Contains(id)))
                        {
                            throw new JiraTaskException("任务必须按前置交付在先的拓扑顺序提交。", 4);
                        }

                        preceding.Add(task.Id);
                    }

                    state.Replanning = false;
                    state.Plan = plan;
                    foreach (CreatedTask created in EarlyTaskPublisher.Created(state))
                    {
                        if (!state.Created.Any(item => item.Id == created.Id))
                        {
                            state.Created.Add(created);
                        }
                    }

                    state.Stage = "publishing";
                    await store.SaveAsync(state, token);
                    await CreateTasksAsync(state, token);
                    toolSucceeded = true;
                    return new
                    {
                        ok = true,
                        tasks = state.Created
                    };
                }, (thread, turn, token) => SetSessionAsync(state, execution, thread, turn, token), cancellation);
                using JsonDocument final = JsonDocument.Parse(result);
                if (!toolSucceeded || final.RootElement.GetProperty("status").GetString() != "success" || state.Plan == null || state.Created.Count != state.Plan.Tasks.Length)
                {
                    throw new JiraTaskException("PM did not complete verified task publication. Resume the workflow after checking JIRA.", 3);
                }

                foreach (CreatedTask created in state.Created)
                {
                    await store.UpdateTaskAsync(state, state.Plan!.Tasks.Single(task => task.Id == created.Id), created, cancellation);
                }

                state.Stage = "tasks_created";
                CompleteExecution(state, execution, "completed");
                await store.SaveAsync(state, cancellation);
                return state;
            }
            catch
            {
                await RecordFailureAsync(state, execution, state.PendingTask == null ? "pm_failed" : "outcome_unknown");
                throw;
            }
        }

        private async Task CreateTasksAsync(Workflow state, CancellationToken cancellation)
        {
            // Refresh reused issues before creating dependent tasks; retries repeat only idempotent PUTs.
            if (state.PreviousPlan != null)
            {
                foreach (CreatedTask existing in state.Created)
                {
                    await store.RequireUnstartedAsync(existing.Key, cancellation);
                    await store.UpdateTaskAsync(state, state.Plan!.Tasks.Single(task => task.Id == existing.Id), existing, cancellation);
                }
            }

            // Persist an intent before each POST. An unresolved intent is never automatically posted again.
            foreach (PlannedTask task in state.Plan!.Tasks)
            {
                guard("pm");
                Workflow current = await store.LoadAsync(state.IssueKey, cancellation);
                RequireApproved(current);
                await store.VerifyAttachmentAsync(current, cancellation);
                if (current.Revision != state.Revision || current.Executions.LastOrDefault()?.ExecutionId != state.Executions.Last().ExecutionId || WorkflowContract.Serialize(current.Plan) != WorkflowContract.Serialize(state.Plan))
                {
                    throw new JiraTaskException("Workflow changed while publishing tasks. Reload JIRA before continuing.", 3);
                }

                CreatedTask? created = state.Created.SingleOrDefault(item => item.Id == task.Id);
                if (created != null)
                {
                    await store.VerifyTaskAsync(state, task, created, cancellation);
                    continue;
                }

                created = await store.FindTaskAsync(state, task, cancellation);
                if (created == null && state.PendingTask == task.Id)
                {
                    throw new JiraTaskException("Task creation outcome is still unknown for " + task.Id + ". Check JIRA and its search index before resuming; no second POST was sent.", 3, true);
                }

                if (created == null)
                {
                    state.PendingTask = task.Id;
                    await store.SaveAsync(state, cancellation);
                    try
                    {
                        created = await store.CreateTaskAsync(state, task, cancellation);
                    }
                    catch (JiraTaskException exception) when (!exception.OutcomeUnknown)
                    {
                        state.PendingTask = null;
                        throw;
                    }
                }

                await store.VerifyTaskAsync(state, task, created, cancellation);
                state.Created.Add(created);
                state.PendingTask = null;
                await store.SaveAsync(state, cancellation);
                Console.Error.WriteLine("Created/verified " + task.Role + ": " + created.Key);
            }
        }

        private async Task<AgentExecution> BeginExecutionAsync(Workflow state, string role, string stage, CancellationToken cancellation)
        {
            if (state.Executions.Count(item => item.Role == role && item.Status != "completed") >= 3)
            {
                throw new JiraTaskException(role + " reached the execution limit of 3 failed/interrupted attempts. Review JIRA before starting a new workflow.", 3);
            }

            AgentExecution execution = new(role, Guid.NewGuid().ToString("N"), "", "", "running", DateTimeOffset.UtcNow);
            state.Executions.Add(execution);
            state.Stage = stage;
            await store.SaveAsync(state, cancellation);
            return execution;
        }

        private Task SetSessionAsync(Workflow state, AgentExecution execution, string thread, string turn, CancellationToken cancellation)
        {
            int index = state.Executions.FindIndex(item => item.ExecutionId == execution.ExecutionId);
            state.Executions[index] = state.Executions[index] with
            {
                ThreadId = thread,
                TurnId = turn
            };
            return store.SaveAsync(state, cancellation);
        }

        private static void CompleteExecution(Workflow state, AgentExecution execution, string status)
        {
            int index = state.Executions.FindIndex(item => item.ExecutionId == execution.ExecutionId);
            state.Executions[index] = state.Executions[index] with
            {
                Status = status
            };
        }

        private async Task RecordFailureAsync(Workflow state, AgentExecution execution, string stage)
        {
            state.Stage = stage;
            CompleteExecution(state, execution, "failed");
            using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(5));
            try
            {
                Workflow current = await store.LoadAsync(state.IssueKey, deadline.Token);
                if (current.DocumentHash != state.DocumentHash || current.ApprovedRevision != state.ApprovedRevision || current.Executions.LastOrDefault()?.ExecutionId != execution.ExecutionId)
                {
                    Console.Error.WriteLine("JIRA workflow changed; preserving the newer state instead of overwriting it with this failure.");
                    return;
                }

                await store.SaveAsync(state, deadline.Token);
            }
            catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException or JiraTaskException or IOException)
            {
                Console.Error.WriteLine("Could not record failure in JIRA. Resume from " + state.IssueKey + " to reconcile the saved execution.");
            }
        }

        private static string Revision(Workflow state)
        {
            return WorkflowContract.Hash(state.DocumentHash + "\n" + WorkflowContract.Serialize(state.Design));
        }

        private static void RequireApproved(Workflow state)
        {
            if (state.Design == null || state.Design.Questions.Length > 0 || state.Revision != Revision(state) || state.ApprovedRevision != state.Revision || string.IsNullOrWhiteSpace(state.ApprovedBy) || state.ApprovedAt == null)
            {
                throw new JiraTaskException("The current requirement revision has not been approved by the user.", 3);
            }

            WorkflowContract.ValidateDesign(state.Design);
        }
    }
}
