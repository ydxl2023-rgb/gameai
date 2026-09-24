using System.Text.Json;

using GameCLI.Agents;
using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Core
{
    /// <summary>Dispatches only ready professional tasks and binds every delivery to its upstream versions.</summary>
    internal sealed class DeliveryWorkflow
    {
        private readonly JiraWorkflowStore store;

        private readonly IWorkflowAgent agent;

        private readonly DeliveryVerifier verifier;

        private readonly Action<string> guard;

        public DeliveryWorkflow(JiraWorkflowStore store, IWorkflowAgent agent, string project, Action<string> guard)
        {
            this.store = store;
            this.agent = agent;
            verifier = new DeliveryVerifier(project);
            this.guard = guard;
        }

        /// <summary>Reads fresh JIRA records and verifies artifacts without starting an agent or writing state.</summary>
        public async Task<GateReport> InspectAsync(string issue, CancellationToken cancellation)
        {
            Workflow state = await store.LoadAsync(issue, cancellation);
            PlannedTask[] tasks = state.Plan?.Tasks ?? (state.Design == null ? Array.Empty<PlannedTask>() : EarlyTaskPublisher.BuildTasks(state.Design));
            bool approved = IsApproved(state);
            Dictionary<string, TaskGate> gates = new(StringComparer.Ordinal);
            while (gates.Count < tasks.Length)
            {
                int before = gates.Count;
                foreach (PlannedTask task in tasks.Where(task => !gates.ContainsKey(task.Id)))
                {
                    if (!task.DependsOn.All(gates.ContainsKey))
                    {
                        continue;
                    }

                    CreatedTask? created = FindCreated(state, task.Id);
                    if (created == null)
                    {
                        gates.Add(task.Id, new TaskGate(task.Id, "", task.Role, "blocked", "专业子任务尚未登记。", task.DependsOn, null));
                        continue;
                    }

                    await store.VerifyTaskAsync(state, task, created, cancellation);
                    JiraTaskState native = await store.ReadTaskStateAsync(created.Key, cancellation);
                    TaskDelivery? delivery = await store.ReadDeliveryAsync(created.Key, cancellation);
                    string status = "ready";
                    string reason = "依赖已满足，可以启动专业代理。";
                    if (!approved)
                    {
                        status = "blocked";
                        reason = "当前需求版本尚未批准或专业计划尚未发布。";
                    }
                    else if (task.DependsOn.Any(id => gates[id].State != "complete"))
                    {
                        status = "blocked";
                        reason = "前置任务未完成或交付已失效：" + string.Join("、", task.DependsOn.Where(id => gates[id].State != "complete").Select(id => gates[id].IssueKey));
                    }
                    else if (delivery != null)
                    {
                        if (delivery.WorkflowId != state.Id || delivery.Revision != state.Revision || delivery.TaskHash != TaskHash(task) || !SameVersions(delivery.DependencyVersions, Versions(task, gates)))
                        {
                            status = "stale";
                            reason = "需求、任务范围或上游交付版本已改变，需要返工。";
                        }
                        else if (delivery.Status == "running")
                        {
                            status = "running";
                            reason = "已有执行记录；中断时先核实运行进程和副作用，禁止自动重复启动。";
                        }
                        else if (delivery.Status == "failed")
                        {
                            status = "failed";
                            reason = "上次执行未通过；排除原因后显式重试。";
                        }
                        else
                        {
                            try
                            {
                                await verifier.VerifyAsync(delivery.Result!, cancellation);
                                status = native.Done ? "complete" : "waiting_review";
                                reason = native.Done ? "子任务已完成，输入版本与交付文件校验通过。" : task.Role == "Development" ? "程序交付校验通过，编排器可完成子任务并启动验收。" : "交付校验通过；审核后将子任务设为完成，再继续调度。";
                                if (!native.Done && delivery.CompletionRequested)
                                {
                                    status = "blocked";
                                    reason = "程序完成转换已请求但尚未确认；核实远端状态，禁止重复提交。";
                                }
                            }
                            catch (Exception exception) when (exception is JiraTaskException or IOException or UnauthorizedAccessException or ArgumentException)
                            {
                                status = "stale";
                                reason = "交付校验失败：" + exception.Message;
                            }
                        }
                    }
                    else if (native.Done)
                    {
                        status = "blocked";
                        reason = "单据已完成但没有有效交付记录；先核实并重新打开任务。";
                    }

                    gates.Add(task.Id, new TaskGate(task.Id, created.Key, task.Role, status, reason, task.DependsOn, delivery));
                }

                if (before == gates.Count)
                {
                    throw new JiraTaskException("专业任务存在循环依赖或缺少前置任务。", 3);
                }
            }

            return new GateReport(issue, state.Revision, approved, approved && gates.Count > 0 && gates.Values.All(gate => gate.State == "complete"), gates.Values.ToArray());
        }

        /// <summary>Stops at review, failure or missing prerequisites. Repeated dispatch never restarts submitted work.</summary>
        public async Task<GateReport> DispatchAsync(string issue, string? retryTask, CancellationToken cancellation)
        {
            GateReport report = await InspectAsync(issue, cancellation);
            await PublishResultsAsync(report, cancellation);
            if (retryTask != null && !report.Tasks.Any(task => task.IssueKey == retryTask))
            {
                throw new ArgumentException("重试单据不属于当前需求。");
            }

            while (report.Approved)
            {
                TaskGate? submitted = retryTask == null ? report.Tasks.FirstOrDefault(task => task.Role == "Development" && task.State == "waiting_review") : null;
                if (submitted != null)
                {
                    await CompleteDevelopmentAsync(issue, submitted, cancellation);
                    report = await InspectAsync(issue, cancellation);
                    continue;
                }

                TaskGate? next = retryTask == null ? report.Tasks.FirstOrDefault(task => task.State == "ready") : report.Tasks.FirstOrDefault(task => task.IssueKey == retryTask && task.State is "failed" or "stale");
                if (next == null)
                {
                    if (retryTask != null)
                    {
                        throw new JiraTaskException("仅能显式重试依赖已满足且失败或交付失效的任务。", 3);
                    }

                    break;
                }

                await ExecuteAsync(issue, next, report, cancellation);
                retryTask = null;
                report = await InspectAsync(issue, cancellation);
            }

            return report;
        }

        private async Task CompleteDevelopmentAsync(string issue, TaskGate submitted, CancellationToken cancellation)
        {
            guard("development");
            Workflow state = await store.LoadAsync(issue, cancellation);
            string transition = await store.CompletionTransitionAsync(submitted.IssueKey, cancellation);
            GateReport current = await InspectAsync(issue, cancellation);
            TaskGate? fresh = current.Tasks.FirstOrDefault(task => task.IssueKey == submitted.IssueKey);
            if (!current.Approved || current.Revision != state.Revision || fresh?.State != "waiting_review" || fresh.Delivery?.Version != submitted.Delivery!.Version)
            {
                throw new JiraTaskException("程序交付或前置状态已改变，停止完成转换。", 3);
            }

            TaskDelivery delivery = fresh.Delivery!;
            PlannedTask task = state.Plan!.Tasks.Single(task => task.Id == fresh.TaskId);
            delivery.CompletionRequested = true;
            await store.SaveDeliveryAsync(state, task, FindCreated(state, task.Id)!, delivery, cancellation);
            try
            {
                await store.CompleteTaskAsync(delivery.IssueKey, transition, cancellation);
            }
            catch (JiraTaskException exception) when (!exception.OutcomeUnknown && exception.ExitCode is 2 or 3)
            {
                // A definite field/permission rejection can be retried after configuration repair, without rerunning the agent.
                TaskDelivery? latest = await store.ReadDeliveryAsync(delivery.IssueKey, cancellation);
                if (latest?.Version == delivery.Version && latest.Status == "submitted")
                {
                    latest.CompletionRequested = false;
                    await store.SaveDeliveryAsync(state, task, FindCreated(state, task.Id)!, latest, cancellation);
                }

                throw;
            }

            if (!(await store.ReadTaskStateAsync(delivery.IssueKey, cancellation)).Done)
            {
                throw new JiraTaskException("程序任务完成转换尚未确认，请核实远端状态。", 3);
            }
        }

        /// <inheritdoc />
        private async Task ExecuteAsync(string issue, TaskGate gate, GateReport report, CancellationToken cancellation)
        {
            guard(gate.Role.ToLowerInvariant());
            Workflow state = await store.LoadAsync(issue, cancellation);
            if (!IsApproved(state) || state.Revision != report.Revision)
            {
                throw new JiraTaskException("需求版本或审批已变化。", 3);
            }

            PlannedTask task = state.Plan!.Tasks.Single(task => task.Id == gate.TaskId);
            CreatedTask created = FindCreated(state, task.Id)!;
            TaskDelivery? previous = await store.ReadDeliveryAsync(created.Key, cancellation);
            if (WorkflowContract.Serialize(previous) != WorkflowContract.Serialize(gate.Delivery) || previous?.Status == "running")
            {
                throw new JiraTaskException("执行记录已改变或仍在运行，停止重复启动。", 3);
            }

            if ((await store.ReadTaskStateAsync(created.Key, cancellation)).Done)
            {
                throw new JiraTaskException("返工前必须重新打开子任务：" + created.Key, 3);
            }

            TaskDelivery delivery = new()
            {
                WorkflowId = state.Id,
                IssueKey = created.Key,
                Revision = state.Revision,
                TaskHash = TaskHash(task),
                ExecutionId = Guid.NewGuid().ToString("N"),
                Attempts = (previous?.Attempts ?? 0) + 1,
                DependencyVersions = Versions(task, report.Tasks.ToDictionary(item => item.TaskId)),
                StartedAt = DateTimeOffset.UtcNow
            };
            if (delivery.Attempts > 3)
            {
                throw new JiraTaskException("该任务已达到三次执行上限，需要人工处理。", 3);
            }

            // The durable intent precedes process creation; ambiguous writes must never launch a second worker.
            await store.SaveDeliveryAsync(state, task, created, delivery, cancellation);
            bool submissionAttempted = false;
            try
            {
                await CheckCurrentAsync(state, task, delivery, cancellation);
                string input = WorkflowContract.Serialize(new
                {
                    issue_key = created.Key,
                    approved_design = state.Design,
                    task,
                    execution_id = delivery.ExecutionId,
                    revision = state.Revision,
                    upstream = report.Tasks.Where(item => task.DependsOn.Contains(item.TaskId)).Select(item => new
                    {
                        item.IssueKey,
                        item.Delivery
                    }).ToArray()
                });
                string output = await agent.RunAsync(task.Role, input, TaskDelivery.ResultSchema, delivery.ExecutionId, null, async (thread, turn, token) =>
                {
                    await CheckCurrentAsync(state, task, delivery, token);
                    delivery.ThreadId = thread;
                    delivery.TurnId = turn;
                    await store.SaveDeliveryAsync(state, task, created, delivery, token);
                }, cancellation);
                DeliveryResult result = WorkflowContract.Parse<DeliveryResult>(output);
                delivery.Result = result;
                WorkflowContract.RequireText(result.Summary, 2000);
                if (result.Verdict != "pass")
                {
                    throw new JiraTaskException("专业代理未通过：" + result.Summary, 3);
                }

                await verifier.VerifyAsync(result, cancellation);
                await CheckCurrentAsync(state, task, delivery, cancellation);
                if ((await store.ReadTaskStateAsync(created.Key, cancellation)).Done)
                {
                    throw new JiraTaskException("子任务在交付提交前已被完成，请重新打开并核实交付。", 3);
                }

                delivery.Result = result;
                delivery.Status = "submitted";
                delivery.SubmittedAt = DateTimeOffset.UtcNow;
                delivery.Version = delivery.ComputeVersion();
                submissionAttempted = true;
                await store.SaveDeliveryAsync(state, task, created, delivery, cancellation);
            }
            catch (Exception failure)
            {
                // An uncertain submission stays untouched; the next read reconciles the server's actual record.
                if (!submissionAttempted)
                {
                    using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(5));
                    try
                    {
                        TaskDelivery? latest = await store.ReadDeliveryAsync(created.Key, deadline.Token);
                        Workflow current = await store.LoadAsync(state.IssueKey, deadline.Token);
                        if (latest?.ExecutionId == delivery.ExecutionId && latest.Status == "running" && current.Revision == state.Revision && WorkflowContract.Serialize(current.Plan) == WorkflowContract.Serialize(state.Plan))
                        {
                            latest.Status = "failed";
                            latest.Result = delivery.Result;
                            latest.FailureSummary = failure is JiraTaskException ? failure.Message : failure is OperationCanceledException ? "执行已取消或超时，未报告完成。" : "执行连接、结果格式或产物校验异常，请核对本次代理会话。";
                            await store.SaveDeliveryAsync(current, task, created, latest, deadline.Token);
                            await store.PublishExecutionCommentAsync(created.Key, latest.ExecutionId, ExecutionComment.Delivery(task.Role, latest), deadline.Token);
                        }
                    }
                    catch (Exception exception) when (exception is IOException or HttpRequestException or OperationCanceledException or JiraTaskException)
                    {
                        Console.Error.WriteLine("未能回写执行失败，继续前必须核实单据执行记录。");
                    }
                }

                throw;
            }

            await store.PublishExecutionCommentAsync(created.Key, delivery.ExecutionId, ExecutionComment.Delivery(task.Role, delivery), cancellation);
        }

        private async Task PublishResultsAsync(GateReport report, CancellationToken cancellation)
        {
            foreach (TaskGate task in report.Tasks)
            {
                if (task.Delivery is { Status: "submitted" or "failed" } delivery)
                {
                    await store.PublishExecutionCommentAsync(task.IssueKey, delivery.ExecutionId, ExecutionComment.Delivery(task.Role, delivery), cancellation);
                }
            }
        }

        private async Task CheckCurrentAsync(Workflow expected, PlannedTask task, TaskDelivery delivery, CancellationToken cancellation)
        {
            guard(task.Role.ToLowerInvariant());
            Workflow current = await store.LoadAsync(expected.IssueKey, cancellation);
            GateReport gates = await InspectAsync(expected.IssueKey, cancellation);
            TaskDelivery? latest = await store.ReadDeliveryAsync(delivery.IssueKey, cancellation);
            if (!IsApproved(current) || current.Revision != expected.Revision || current.Plan == null || WorkflowContract.Serialize(current.Plan) != WorkflowContract.Serialize(expected.Plan) || latest?.ExecutionId != delivery.ExecutionId || latest.Status != "running" || !gates.Approved || gates.Tasks.Any(item => task.DependsOn.Contains(item.TaskId) && item.State != "complete") || !SameVersions(delivery.DependencyVersions, Versions(task, gates.Tasks.ToDictionary(item => item.TaskId))))
            {
                throw new JiraTaskException("运行期间审批、执行身份或前置交付已改变，停止提交。", 3);
            }
        }

        private static bool IsApproved(Workflow state)
        {
            return state.Stage == "tasks_created" && state.Plan != null && state.Design != null && state.Design.Questions.Length == 0 && state.Revision == WorkflowContract.Hash(state.DocumentHash + "\n" + WorkflowContract.Serialize(state.Design)) && state.ApprovedRevision == state.Revision && !string.IsNullOrWhiteSpace(state.ApprovedBy) && state.ApprovedAt != null;
        }

        private static CreatedTask? FindCreated(Workflow state, string id)
        {
            return state.Created.Find(item => item.Id == id) ?? EarlyTaskPublisher.Created(state).FirstOrDefault(item => item.Id == id);
        }

        private static string TaskHash(PlannedTask task) => WorkflowContract.Hash(WorkflowContract.Serialize(task));

        private static Dictionary<string, string> Versions(PlannedTask task, Dictionary<string, TaskGate> gates)
        {
            return task.DependsOn.ToDictionary(id => id, id => gates[id].Delivery?.Version ?? "", StringComparer.Ordinal);
        }

        private static bool SameVersions(Dictionary<string, string> left, Dictionary<string, string> right)
        {
            return left.Count == right.Count && left.All(item => right.TryGetValue(item.Key, out string? value) && value == item.Value);
        }
    }
}
