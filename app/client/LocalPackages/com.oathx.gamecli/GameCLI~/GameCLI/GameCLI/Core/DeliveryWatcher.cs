using System.ComponentModel;
using System.Text.Json;
using System.Threading.Channels;

using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Core
{
    /// <summary>Coalesces event hints into serial, authoritative reconciliation on one designated execution host.</summary>
    internal sealed class DeliveryWatcher
    {
        private readonly JiraWorkflowStore store;
        private readonly DeliveryWorkflow workflow;
        private readonly Func<IDisposable> acquireLease;
        private readonly Action guard;

        private readonly int executionTimeout;

        public DeliveryWatcher(JiraWorkflowStore store, DeliveryWorkflow workflow, Func<IDisposable> acquireLease, Action guard, int executionTimeout = 600)
        {
            this.store = store;
            this.workflow = workflow;
            this.acquireLease = acquireLease;
            this.guard = guard;
            this.executionTimeout = executionTimeout;
        }

        /// <summary>Reconciles on registration, reconnect and related issue changes; never polls JIRA.</summary>
        public async Task RunAsync(string issue, Uri server, Action<GateReport> report, CancellationToken cancellation)
        {
            Workflow initial = await store.LoadAsync(issue, cancellation);
            if (initial.ProjectKey != store.ProjectKey)
            {
                throw new JiraTaskException("需求不属于当前配置的 JIRA 项目。", 3);
            }

            using CancellationTokenSource lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            Channel<bool> hints = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
            {
                FullMode = BoundedChannelFullMode.DropWrite,
                SingleReader = true,
                SingleWriter = true
            });
            object executionLock = new();
            CancellationTokenSource? active = null;
            bool connected = false;
            ServerEventClient client = new(server, initial.ProjectKey, "orchestrator-" + initial.Id, guard);
            Task listener = ListenAsync();
            async Task ListenAsync()
            {
                try
                {
                    await client.RunAsync((envelope, _) =>
                    {
                        bool wake = false;
                        lock (executionLock)
                        {
                            if (envelope.Type == "client.reconnecting")
                            {
                                connected = false;
                                active?.Cancel();
                            }
                            else if (envelope.Type == "worker.registered")
                            {
                                connected = true;
                                wake = true;
                            }
                            else if (envelope.Type == "jira.issue_changed")
                            {
                                wake = envelope.Payload.GetProperty("issue_key").GetString() == issue || envelope.Payload.GetProperty("parent_key").GetString() == issue;
                            }
                        }

                        Console.Error.WriteLine(WorkflowContract.Serialize(envelope));
                        if (wake)
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
                finally
                {
                    lock (executionLock)
                    {
                        connected = false;
                        active?.Cancel();
                    }
                }
            }

            try
            {
                await foreach (bool hint in hints.Reader.ReadAllAsync(cancellation))
                {
                    using CancellationTokenSource execution = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                    execution.CancelAfter(TimeSpan.FromSeconds(executionTimeout));
                    lock (executionLock)
                    {
                        if (!connected)
                        {
                            continue;
                        }

                        active = execution;
                    }

                    try
                    {
                        guard();
                        using IDisposable lease = acquireLease();
                        report(await workflow.DispatchAsync(issue, null, execution.Token));
                    }
                    catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
                    {
                        Console.Error.WriteLine("本次执行已停止（连接中断或执行超时）；重连后核对 JIRA 记录，不自动重跑失败任务。");
                    }
                    catch (Exception exception) when (exception is JiraTaskException or HttpRequestException or IOException or JsonException or InvalidOperationException or CodexInteractionException or Win32Exception or UnauthorizedAccessException or KeyNotFoundException)
                    {
                        Console.WriteLine(WorkflowContract.Serialize(new
                        {
                            type = "orchestrator.blocked",
                            issue_key = issue,
                            message = exception is JiraTaskException ? exception.Message : "调度或结果回写失败，等待后续事件重新核对 JIRA。"
                        }));
                    }
                    finally
                    {
                        lock (executionLock)
                        {
                            active = null;
                        }
                    }
                }
            }
            finally
            {
                lifetime.Cancel();
                try
                {
                    await listener;
                }
                catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
                {
                    // The command owns both the event subscription and its active execution.
                }
            }
        }
    }
}
