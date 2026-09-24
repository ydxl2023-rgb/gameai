using System.Text.Json;
using System.Threading.Channels;

using GameCLI.Agents;
using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Core
{
    /// <summary>Connects event transport to one real, read-only Art execution without changing delivery gates.</summary>
    internal sealed class AgentProbeWorkflow
    {
        private readonly JiraWorkflowStore store;
        private readonly IWorkflowAgent agent;
        private readonly Action guard;

        private readonly string role;

        public AgentProbeWorkflow(JiraWorkflowStore store, IWorkflowAgent agent, Action guard, string role = "Art")
        {
            this.store = store;
            this.agent = agent;
            this.guard = guard;
            this.role = role;
        }

        /// <summary>Reconciles on subscription and notifications. The caller owns the same-machine workflow lock.</summary>
        public async Task<AgentProbe> RunAsync(string issue, Uri server, bool waitForEvent, CancellationToken cancellation)
        {
            Workflow initial = await store.LoadAsync(issue, cancellation);
            if (initial.ProjectKey != store.ProjectKey)
            {
                throw new JiraTaskException("需求不属于已配置的 JIRA 项目。", 3);
            }

            using CancellationTokenSource lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            Channel<bool> hints = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
            {
                FullMode = BoundedChannelFullMode.DropWrite,
                SingleReader = true,
                SingleWriter = true
            });
            ServerEventClient client = new(server, initial.ProjectKey, role.ToLowerInvariant() + "-probe-" + initial.Id, guard);
            Task listening = ListenAsync();
            async Task ListenAsync()
            {
                try
                {
                    await client.RunAsync((envelope, _) =>
                    {
                        Console.Error.WriteLine(WorkflowContract.Serialize(envelope));
                        bool sync = envelope.Type == "worker.registered" && !waitForEvent;
                        bool related = envelope.Type == "jira.issue_changed" &&
                            (envelope.Payload.GetProperty("issue_key").GetString() == issue ||
                             envelope.Payload.GetProperty("parent_key").GetString() == issue);
                        if (sync || related)
                        {
                            hints.Writer.TryWrite(true);
                        }

                        return Task.CompletedTask;
                    }, 0, lifetime.Token);
                    hints.Writer.TryComplete();
                }
                catch (Exception exception)
                {
                    hints.Writer.TryComplete(exception);
                    throw;
                }
            }

            try
            {
                await hints.Reader.ReadAsync(lifetime.Token);
                // Socket reception and heartbeat continue while the owned agent runs.
                Task<AgentProbe> execution = ExecuteAsync(issue, lifetime.Token);
                if (await Task.WhenAny(execution, listening) == listening)
                {
                    lifetime.Cancel();
                    try
                    {
                        await execution;
                    }
                    catch (OperationCanceledException)
                    {
                        // The listener failure remains the primary cause.
                    }

                    await listening;
                    throw new IOException("事件监听意外结束。");
                }

                return await execution;
            }
            finally
            {
                lifetime.Cancel();
                try
                {
                    await listening;
                }
                catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
                {
                    // This command owns and stops the event subscription.
                }
            }
        }

        /// <summary>Runs one diagnostic after fresh identity checks; caller must hold the workflow execution lock.</summary>
        internal async Task<AgentProbe> ExecuteAsync(string issue, CancellationToken cancellation)
        {
            guard();
            Workflow state = await store.LoadAsync(issue, cancellation);
            PlannedTask[] tasks = state.Plan?.Tasks ?? state.EarlyTasks.Select(item => item.Task).ToArray();
            PlannedTask? task = tasks.FirstOrDefault(item => item.Role == role) ?? (role == "Art" ? state.ArtTask : null);
            CreatedTask? created = task == null ? null : state.Created.FirstOrDefault(item => item.Id == task.Id) ?? state.EarlyTasks.FirstOrDefault(item => item.Task.Id == task.Id)?.Created ?? (role == "Art" ? state.ArtCreated : null);
            if (task == null || created == null || state.Design == null)
            {
                throw new JiraTaskException("需求尚未登记可核对的专业子任务。", 3);
            }

            await store.VerifyTaskAsync(state, task, created, cancellation);
            if ((await store.ReadTaskStateAsync(created.Key, cancellation)).Done)
            {
                throw new JiraTaskException("专业子任务已完成，不启动联调。", 3);
            }

            AgentProbe? previous = await store.ReadAgentProbeAsync(created.Key, cancellation, role);
            if (previous != null)
            {
                if (previous.Role != role || previous.WorkflowId != state.Id || previous.IssueKey != created.Key || previous.Revision != state.Revision)
                {
                    throw new JiraTaskException("已有联调记录的任务或需求版本不同，请先核对。", 3);
                }

                if (previous.Status == "failed")
                {
                    await store.PublishExecutionCommentAsync(previous.IssueKey, previous.ExecutionId, ExecutionComment.Probe(previous), cancellation);
                }

                if (previous.Status != "completed" || previous.Result == null)
                {
                    throw new JiraTaskException("已有未确认的专业代理联调记录，禁止重复启动，请先核对会话：" + previous.ThreadId, 3);
                }

                Console.Error.WriteLine("复用 JIRA 中已完成的专业代理联调记录，不重复启动。");
                await store.PublishExecutionCommentAsync(previous.IssueKey, previous.ExecutionId, ExecutionComment.Probe(previous), cancellation);
                return previous;
            }

            AgentProbe record = new(state.Id, state.Revision, created.Key, Guid.NewGuid().ToString("N"), "starting", "", "", DateTimeOffset.UtcNow, null, role);
            // Persist intent before launching; uncertain writes or interrupted runs are never automatically repeated.
            await store.SaveAgentProbeAsync(record, cancellation);
            object schema = WorkflowContract.ObjectSchema(new()
            {
                ["issue_key"] = WorkflowContract.Text,
                ["execution_id"] = WorkflowContract.Text,
                ["acknowledged"] = new
                {
                    type = "boolean"
                },
                ["assets_generated"] = new
                {
                    type = "boolean"
                },
                ["summary"] = WorkflowContract.Text,
                ["planned_outputs"] = WorkflowContract.TextList
            });
            string input = WorkflowContract.Serialize(new
            {
                mode = role.ToLowerInvariant() + "_probe",
                issue_key = created.Key,
                execution_id = record.ExecutionId,
                task,
                instruction = "本次仅验证专业代理启动和任务接收，不编写代码，不生成文件或资源，不完成单据。请用中文简述已接收的专业任务及未来计划产物，acknowledged 返回 true，assets_generated 返回 false。"
            });
            Console.Error.WriteLine("正在启动 " + role + " 联调代理：" + created.Key + "；执行编号：" + record.ExecutionId);
            guard();
            bool resultWriteAttempted = false;
            try
            {
                string raw = await agent.RunAsync(role, input, schema, record.ExecutionId, null, async (thread, turn, token) =>
                {
                    record = record with
                    {
                        Status = "running",
                        ThreadId = thread,
                        TurnId = turn
                    };
                    await store.SaveAgentProbeAsync(record, token);
                    Console.Error.WriteLine(role + " 代理已启动；会话：" + thread + "；轮次：" + turn);
                }, cancellation);
                AgentProbeResult result = WorkflowContract.Parse<AgentProbeResult>(raw);
                if (result.IssueKey != created.Key || result.ExecutionId != record.ExecutionId || !result.Acknowledged || result.AssetsGenerated || string.IsNullOrWhiteSpace(result.Summary) || result.PlannedOutputs == null || result.PlannedOutputs.Length == 0 || result.PlannedOutputs.Any(string.IsNullOrWhiteSpace))
                {
                    throw new JsonException("专业代理联调结果不符合只读任务接收契约。");
                }

                Workflow current = await store.LoadAsync(issue, cancellation);
                if (current.Revision != state.Revision || current.Id != state.Id)
                {
                    throw new JiraTaskException("联调期间需求版本发生变化，停止记录成功。", 3);
                }

                record = record with
                {
                    Status = "completed",
                    Result = result
                };
                resultWriteAttempted = true;
                await store.SaveAgentProbeAsync(record, cancellation);
            }
            catch (Exception failure)
            {
                if (!resultWriteAttempted)
                {
                    using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(10));
                    try
                    {
                        record = record with
                        {
                            Status = "failed",
                            FailureSummary = failure is OperationCanceledException ? "联调已取消或超时，没有制作资源或提交代码。" : "代理启动、返回格式或输入版本检查失败，请核对该会话。"
                        };
                        await store.SaveAgentProbeAsync(record, deadline.Token);
                        await store.PublishExecutionCommentAsync(record.IssueKey, record.ExecutionId, ExecutionComment.Probe(record), deadline.Token);
                    }
                    catch (Exception exception) when (exception is JiraTaskException or HttpRequestException or IOException or OperationCanceledException)
                    {
                        Console.Error.WriteLine("未能确认联调失败评论，恢复时必须先核对 JIRA 记录。");
                    }
                }

                throw;
            }
            await store.PublishExecutionCommentAsync(record.IssueKey, record.ExecutionId, ExecutionComment.Probe(record), cancellation);
            Console.Error.WriteLine("专业代理联调完成并已回写 JIRA；未制作资源，未改变单据状态。");
            return record;
        }
    }
}
