using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using GameCLI.Agents;
using GameCLI.Contracts;
using GameCLI.Core;
using GameCLI.Services;

namespace GameCLI.DeliverySmoke
{
    internal static class Program
    {
        private static async Task Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 2 && args[0] == "--watch-server")
            {
                await TestWatchTransportAsync(new Uri(args[1]));
                return;
            }

            if (args.Length == 2 && args[0] == "--probe-server")
            {
                using FakeJira handler = new(false);
                using HttpClient http = new(handler);
                JiraWorkflowStore store = new(http, new JiraConnection("https://jira.test", "GAME", "secret"), () =>
                {
                }, null);
                ProbeAgent agent = new(handler, "slow");
                AgentProbeWorkflow workflow = new(store, agent, () =>
                {
                });
                using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(10));
                AgentProbe receipt = await workflow.RunAsync("GAME-1", new Uri(args[1]), true, timeout.Token);
                Require(receipt.Status == "completed" && agent.Calls == 1, "Event-triggered probe");
                Console.WriteLine("PROBE_TRANSPORT_PASS");
                return;
            }

            await TestCommentRecoveryAsync();
            await TestAgentProbeAsync();
            foreach (string mode in new[]
            {
                "chain",
                "unapproved",
                "fake-done",
                "reopened",
                "hash-change",
                "missing-file",
                "new-version",
                "blocked-agent",
                "false-check",
                "approval-change",
                "dependency-change",
                "lost-submit",
                "unknown-intent",
                "disabled",
                "retry-limit",
                "traversal",
                "no-art",
                "running",
                "transition-lost",
                "transition-unknown",
                "transition-rejected",
                "transition-ambiguous"
            })
            {
                string directory = Path.Combine(Path.GetTempPath(), "gamecli-delivery-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(directory);
                try
                {
                    using FakeJira handler = new(mode == "no-art");
                    using HttpClient http = new(handler);
                    JiraWorkflowStore store = new(http, new JiraConnection("https://jira.test", "GAME", "test-secret"), () =>
                    {
                    }, null);
                    FakeAgent agent = new(directory);
                    DeliveryWorkflow workflow = new(store, agent, directory, _ =>
                    {
                        if (mode == "disabled")
                        {
                            throw new JiraTaskException("插件已禁用。", 3);
                        }
                    });
                    CancellationToken token = CancellationToken.None;
                    async Task<GateReport> Dispatch(string? retry = null) => await workflow.DispatchAsync("GAME-1", retry, token);
                    async Task<GateReport> Inspect() => await workflow.InspectAsync("GAME-1", token);
                    string first = handler.State.Created[0].Key;
                    if (mode == "unapproved")
                    {
                        handler.State.ApprovedRevision = null;
                        Require(!(await Dispatch()).Approved && agent.Calls == 0, mode);
                    }
                    else if (mode == "fake-done")
                    {
                        handler.Done.Add(first);
                        Require((await Dispatch()).Tasks[0].State == "blocked" && agent.Calls == 0, mode);
                    }
                    else if (mode is "blocked-agent" or "false-check" or "approval-change" or "unknown-intent" or "disabled" or "retry-limit" or "traversal")
                    {
                        agent.Mode = mode;
                        if (mode == "approval-change")
                        {
                            agent.OnRun = () => handler.State.ApprovedRevision = null;
                        }

                        handler.FailIntent = mode == "unknown-intent";
                        await RejectAsync(() => Dispatch(), mode);
                        if (mode is "unknown-intent" or "disabled")
                        {
                            Require(agent.Calls == 0, mode);
                        }
                        else
                        {
                            Require(handler.Deliveries[first].Status == "failed", mode);
                        }

                        if (mode == "retry-limit")
                        {
                            await RejectAsync(() => Dispatch(first), mode);
                            await RejectAsync(() => Dispatch(first), mode);
                            await RejectAsync(() => Dispatch(first), mode);
                            Require(agent.Calls == 3 && handler.Deliveries[first].Attempts == 3, mode);
                        }

                        if (mode == "blocked-agent")
                        {
                            agent.Mode = "pass";
                            Require((await Dispatch(first)).Tasks[0].State == "waiting_review" && agent.Calls == 2, "explicit retry");
                        }
                    }
                    else if (mode == "lost-submit")
                    {
                        handler.LoseSubmission = true;
                        await RejectAsync(() => Dispatch(), mode);
                        Require(handler.Deliveries[first].Status == "submitted", mode);
                        Require((await Dispatch()).Tasks[0].State == "waiting_review" && agent.Calls == 1, mode);
                    }
                    else if (mode == "no-art")
                    {
                        GateReport report = await Dispatch();
                        Require(report.Tasks[0].State == "complete" && report.Tasks[1].State == "waiting_review" && agent.Calls == 2, mode);
                        handler.Done.Add(handler.State.Created.Last().Key);
                        Require((await Inspect()).Complete, mode);
                    }
                    else if (mode is "transition-lost" or "transition-unknown")
                    {
                        await Dispatch();
                        handler.Done.Add(first);
                        handler.TransitionFault = mode;
                        await RejectAsync(() => Dispatch(), mode);
                        Require(agent.Calls == 2 && handler.Deliveries["GAME-3"].CompletionRequested, mode);
                        GateReport report = await Dispatch();
                        Require(handler.TransitionCalls == 1 && agent.Calls == (mode == "transition-lost" ? 3 : 2), mode);
                        Require(report.Tasks.Last().State == (mode == "transition-lost" ? "waiting_review" : "blocked"), mode);
                    }
                    else if (mode is "transition-rejected" or "transition-ambiguous")
                    {
                        await Dispatch();
                        handler.Done.Add(first);
                        handler.TransitionFault = mode;
                        await RejectAsync(() => Dispatch(), mode);
                        Require(agent.Calls == 2 && !handler.Deliveries["GAME-3"].CompletionRequested, mode);
                        handler.TransitionFault = "";
                        GateReport report = await Dispatch();
                        Require(report.Tasks.Last().State == "waiting_review" && agent.Calls == 3, mode);
                    }
                    else
                    {
                        GateReport report = await Dispatch();
                        Require(report.Tasks[0].State == "waiting_review" && agent.Calls == 1, mode);
                        Require((await Dispatch()).Tasks[0].State == "waiting_review" && agent.Calls == 1, "idempotent dispatch");
                        if (mode == "running")
                        {
                            handler.Deliveries[first].Status = "running";
                            Require((await Dispatch()).Tasks[0].State == "running" && agent.Calls == 1, mode);
                            await RejectAsync(() => Dispatch(first), mode);
                        }
                        else
                        {
                            handler.Done.Add(first);
                            if (mode is "chain" or "no-art")
                            {
                                foreach (CreatedTask child in handler.State.Created.Skip(1))
                                {
                                    report = await Dispatch();
                                    Require(report.Tasks.Single(item => item.IssueKey == child.Key).State == (handler.State.Plan!.Tasks.Single(item => item.Id == child.Id).Role == "Development" ? "complete" : "waiting_review"), mode);
                                    handler.Done.Add(child.Key);
                                }

                                Require((await Inspect()).Complete && agent.Calls == handler.State.Created.Count, mode);
                            }
                            else if (mode == "dependency-change")
                            {
                                agent.OnRun = () => File.AppendAllText(Path.Combine(directory, "Art.txt"), "changed");
                                await RejectAsync(() => Dispatch(), mode);
                                Require(handler.Deliveries["GAME-3"].Status == "failed", mode);
                            }
                            else
                            {
                                await Dispatch();
                                handler.Done.Add("GAME-3");
                                if (mode == "reopened")
                                {
                                    handler.Done.Remove(first);
                                }
                                else if (mode == "hash-change")
                                {
                                    File.AppendAllText(Path.Combine(directory, "Art.txt"), "changed");
                                }
                                else if (mode == "missing-file")
                                {
                                    File.Delete(Path.Combine(directory, "Art.txt"));
                                }
                                else if (mode == "new-version")
                                {
                                    TaskDelivery art = handler.Deliveries[first];
                                    art.ExecutionId = Guid.NewGuid().ToString("N");
                                    art.Version = art.ComputeVersion();
                                }

                                report = await Dispatch();
                                Require(report.Tasks.Last().State == "blocked" && agent.Calls == 3 && !report.Complete, mode);
                            }
                        }
                    }

                    Console.WriteLine("PASS " + mode);
                }
                finally
                {
                    Directory.Delete(directory, true);
                }
            }
        }

        private static async Task RejectAsync(Func<Task> action, string message)
        {
            try
            {
                await action();
            }
            catch (Exception exception) when (exception is JiraTaskException or IOException or HttpRequestException)
            {
                return;
            }

            throw new InvalidOperationException("Expected rejection: " + message);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition)
            {
                throw new InvalidOperationException(message);
            }
        }

        private sealed class FakeAgent : IWorkflowAgent
        {
            private readonly string directory;

            public int Calls
            { get; private set; }

            public string Mode
            { get; set; } = "pass";

            public Action? OnRun
            { get; set; }

            public FakeAgent(string directory)
            {
                this.directory = directory;
            }

            public async Task<string> RunAsync(string role, string input, object schema, string executionId, Func<JsonElement, CancellationToken, Task<object>>? publish, Func<string, string, CancellationToken, Task> sessionStarted, CancellationToken cancellation)
            {
                Calls++;
                if (Mode == "slow")
                {
                    await Task.Delay(350, cancellation);
                }

                await sessionStarted("thread-" + role, "turn-" + Calls, cancellation);
                OnRun?.Invoke();
                string path = role + ".txt";
                await File.WriteAllTextAsync(Path.Combine(directory, path), "测试产物与证据：" + role, cancellation);
                string hash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(directory, path), cancellation))).ToLowerInvariant();
                return WorkflowContract.Serialize(new DeliveryResult(Mode is "blocked-agent" or "retry-limit" ? "blocked" : "pass", "独立测试数据，非实际专业交付。", new[]
                {
                    new DeliveryArtifact(Mode == "traversal" ? "../outside.txt" : path, hash, "模拟交付")
                }, new[]
                {
                    new DeliveryCheck("模拟检查", Mode != "false-check", path)
                }));
            }
        }

        private static async Task TestWatchTransportAsync(Uri address)
        {
            string directory = Path.Combine(Path.GetTempPath(), "gamecli-watch-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            using FakeJira handler = new(false);
            using HttpClient http = new(handler);
            JiraWorkflowStore store = new(http, new JiraConnection("https://jira.test", "GAME", "secret"), () =>
            {
            }, null);
            FakeAgent agent = new(directory);
            agent.Mode = "slow";
            DeliveryWorkflow delivery = new(store, agent, directory, _ =>
            {
            });
            DeliveryWatcher watcher = new(store, delivery, () => new MemoryStream(), () =>
            {
            });
            using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(15));
            Task control = Task.Run(async () =>
            {
                try
                {
                    while (await Console.In.ReadLineAsync(timeout.Token) is string command)
                    {
                        if (command == "complete-art")
                        {
                            handler.Done.Add("GAME-2");
                            Console.WriteLine("{\"type\":\"test.art-reviewed\"}");
                        }
                        else if (command == "stop")
                        {
                            timeout.Cancel();
                            return;
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    // The test owns its private control pipe.
                }
            });
            try
            {
                await watcher.RunAsync("GAME-1", address, gates => Console.WriteLine(WorkflowContract.Serialize(new
                {
                    type = "test.gates",
                    calls = agent.Calls,
                    comments = handler.Comments.Count,
                    gates
                })), timeout.Token);
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested)
            {
                // The harness stops the persistent watcher after checking its output.
            }
            finally
            {
                timeout.Cancel();
                await control;
            }

            Require(agent.Calls == 3 && handler.Comments.Count == 3 && handler.CommentPosts == 3 && handler.TransitionCalls == 1, "Watch must dispatch Art, Development and QA exactly once");
            Require(handler.Comments.Any(text => text.Contains("执行角色：程序", StringComparison.Ordinal)), "Development execution comment");
            Console.WriteLine("{\"type\":\"test.watch-complete\"}");
        }

        private static async Task TestCommentRecoveryAsync()
        {
            foreach (string mode in new[]
            {
                "normal", "lost", "unknown", "denied"
            })
            {
                using FakeJira handler = new(false);
                using HttpClient http = new(handler);
                JiraWorkflowStore store = new(http, new JiraConnection("https://jira.test", "GAME", "secret"), () =>
                {
                }, null);
                string execution = Guid.NewGuid().ToString("N");
                handler.CommentFault = mode;
                async Task Publish() => await store.PublishExecutionCommentAsync("GAME-2", execution, "执行结果：只读联调通过", CancellationToken.None);
                if (mode == "normal")
                {
                    await Publish();
                }
                else
                {
                    await RejectAsync(Publish, mode);
                }

                handler.CommentFault = "";
                if (mode == "unknown")
                {
                    await RejectAsync(Publish, mode);
                    Require(handler.CommentPosts == 1 && handler.Comments.Count == 0, "Unknown POST is not repeated");
                }
                else
                {
                    await Publish();
                    await Publish();
                    Require(handler.Comments.Count == 1 && handler.CommentPosts == (mode == "denied" ? 2 : 1), "Exactly one execution comment");
                }

                Console.WriteLine("Comment recovery: " + mode + " passed");
            }
        }

        private static async Task TestAgentProbeAsync()
        {
            foreach (string mode in new[]
            {
                "success", "intent-lost", "agent-failed", "fabricated-assets", "disabled", "done", "version-changed"
            })
            {
                using FakeJira handler = new(false);
                handler.State.ApprovedRevision = null;
                handler.FailIntent = mode == "intent-lost";
                using HttpClient http = new(handler);
                JiraWorkflowStore store = new(http, new JiraConnection("https://jira.test", "GAME", "secret"), () =>
                {
                }, null);
                ProbeAgent agent = new(handler, mode);
                AgentProbeWorkflow workflow = new(store, agent, () =>
                {
                    if (mode == "disabled")
                    {
                        throw new JiraTaskException("已禁用", 3);
                    }
                });
                if (mode == "done")
                {
                    handler.Done.Add("GAME-2");
                }

                bool failed = false;
                try
                {
                    AgentProbe receipt = await workflow.ExecuteAsync("GAME-1", CancellationToken.None);
                    Require(receipt.Status == "completed" && receipt.Result!.Acknowledged && !receipt.Result.AssetsGenerated, "Probe receipt");
                    AgentProbe repeated = await workflow.ExecuteAsync("GAME-1", CancellationToken.None);
                    Require(repeated.ExecutionId == receipt.ExecutionId && agent.Calls == 1, "Probe deduplication");
                }
                catch (Exception exception) when (exception is JiraTaskException or HttpRequestException or JsonException or IOException)
                {
                    failed = true;
                }

                Require(failed == (mode != "success"), "Probe outcome " + mode);
                Require(handler.Deliveries.Count == 0 && handler.TransitionCalls == 0 && handler.State.ApprovedRevision == null, "Probe must preserve production gates");
                if (mode is "intent-lost" or "disabled" or "done")
                {
                    Require(agent.Calls == 0, "No unauthorized probe launch");
                }

                if (mode == "agent-failed")
                {
                    try
                    {
                        await workflow.ExecuteAsync("GAME-1", CancellationToken.None);
                        throw new InvalidOperationException("Interrupted probe restarted");
                    }
                    catch (JiraTaskException)
                    {
                        Require(agent.Calls == 1, "Unknown runs must not repeat");
                    }
                }

                Console.WriteLine("ART probe: " + mode + " passed");
            }
        }

        private sealed class ProbeAgent : IWorkflowAgent
        {
            private readonly FakeJira handler;
            private readonly string mode;

            public int Calls
            { get; private set; }

            public ProbeAgent(FakeJira handler, string mode)
            {
                this.handler = handler;
                this.mode = mode;
            }

            public async Task<string> RunAsync(string role, string input, object schema, string executionId, Func<JsonElement, CancellationToken, Task<object>>? publish, Func<string, string, CancellationToken, Task> sessionStarted, CancellationToken cancellation)
            {
                Require(handler.Probe?.Status == "starting" && role == "Art" && publish == null, "Intent before actual launch");
                Calls++;
                await sessionStarted("probe-thread", "probe-turn", cancellation);
                if (mode == "agent-failed")
                {
                    throw new IOException("Simulated interruption");
                }

                if (mode == "slow")
                {
                    await Task.Delay(500, cancellation);
                }

                if (mode == "version-changed")
                {
                    handler.State.Revision = "changed";
                }

                return WorkflowContract.Serialize(new AgentProbeResult("GAME-2", executionId, true, mode == "fabricated-assets", "已接收任务，未生成资源。", new[]
                {
                    "背包界面设计"
                }));
            }
        }

        private sealed class FakeJira : HttpMessageHandler
        {
            public Dictionary<string, JsonElement> CommentReceipts
            { get; } = new();

            public List<string> Comments
            { get; } = new();

            public string CommentFault
            { get; set; } = "";

            public int CommentPosts
            { get; private set; }

            public AgentProbe? Probe
            { get; private set; }

            public Workflow State
            { get; }

            public Dictionary<string, TaskDelivery> Deliveries
            { get; } = new();

            public HashSet<string> Done
            { get; } = new();

            public bool LoseSubmission
            { get; set; }

            public bool FailIntent
            { get; set; }

            public string TransitionFault
            { get; set; } = "";

            public int TransitionCalls
            { get; private set; }

            public FakeJira(bool noArt)
            {
                DesignBrief design = new("背包", "移动端背包", new[]
                {
                    "显示背包"
                }, noArt ? Array.Empty<string>() : new[]
                {
                    "制作界面设计"
                }, new[]
                {
                    "实现背包"
                }, Array.Empty<string>());
                State = new Workflow
                {
                    IssueKey = "GAME-1",
                    ProjectKey = "GAME",
                    Stage = "tasks_created",
                    Document = "开发背包",
                    DocumentHash = WorkflowContract.Hash("开发背包"),
                    Design = design,
                    Plan = new TaskPlan(EarlyTaskPublisher.BuildTasks(design)),
                    ApprovedBy = "test-user",
                    ApprovedAt = DateTimeOffset.UtcNow
                };
                State.Revision = WorkflowContract.Hash(State.DocumentHash + "\n" + WorkflowContract.Serialize(design));
                State.ApprovedRevision = State.Revision;
                State.Created = State.Plan.Tasks.Select((task, index) => new CreatedTask(task.Id, "GAME-" + (index + 2), "https://jira.test/browse/GAME-" + (index + 2))).ToList();
            }

            /// <inheritdoc />
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                string[] parts = request.RequestUri!.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
                string key = parts[4];
                if (parts.Length > 6 && parts[6].StartsWith("gamecli.comment.", StringComparison.Ordinal))
                {
                    string marker = key + "/" + parts[6];
                    if (request.Method == HttpMethod.Get)
                    {
                        return CommentReceipts.TryGetValue(marker, out JsonElement receipt) ? Json(new
                        {
                            value = receipt
                        }) : new HttpResponseMessage(HttpStatusCode.NotFound);
                    }

                    CommentReceipts[marker] = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken)).RootElement.Clone();
                    return new HttpResponseMessage(HttpStatusCode.NoContent);
                }

                if (parts.Length > 5 && parts[5] == "comment")
                {
                    if (request.Method == HttpMethod.Get)
                    {
                        return Json(new
                        {
                            total = Comments.Count,
                            comments = Comments.Select((text, index) => new
                            {
                                id = (index + 1).ToString(),
                                body = text
                            }).ToArray()
                        });
                    }

                    Require(request.Method == HttpMethod.Post, "Comment method");
                    CommentPosts++;
                    if (CommentFault == "denied")
                    {
                        return new HttpResponseMessage(HttpStatusCode.Forbidden)
                        {
                            Content = new StringContent("{}")
                        };
                    }

                    if (CommentFault != "unknown")
                    {
                        using JsonDocument comment = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
                        Comments.Add(comment.RootElement.GetProperty("body").GetString()!);
                    }

                    if (CommentFault is "lost" or "unknown")
                    {
                        throw new HttpRequestException("Lost comment response");
                    }

                    return Json(new
                    {
                        id = Comments.Count.ToString()
                    });
                }

                if (parts.Length > 6 && parts[6] == "gamecli.art-probe.v1")
                {
                    if (request.Method == HttpMethod.Get)
                    {
                        return Probe == null ? new HttpResponseMessage(HttpStatusCode.NotFound) : Json(new
                        {
                            value = JsonSerializer.SerializeToElement(Probe, WorkflowContract.Json)
                        });
                    }

                    Require(request.Method == HttpMethod.Put, "Unexpected probe mutation");
                    Probe = WorkflowContract.Parse<AgentProbe>(await request.Content!.ReadAsStringAsync(cancellationToken));
                    if (FailIntent)
                    {
                        throw new HttpRequestException("Lost intent response");
                    }

                    return new HttpResponseMessage(HttpStatusCode.NoContent);
                }

                if (request.Method == HttpMethod.Get)
                {
                    if (parts.Length > 5 && parts[5] == "transitions")
                    {
                        return Json(new
                        {
                            transitions = Enumerable.Range(0, TransitionFault == "transition-ambiguous" ? 2 : 1).Select(index => new
                            {
                                id = (31 + index).ToString(),
                                to = new
                                {
                                    statusCategory = new
                                    {
                                        key = "done"
                                    }
                                }
                            }).ToArray()
                        });
                    }

                    if (parts.Length > 5)
                    {
                        if (parts[6] == "gamecli.workflow.v1")
                        {
                            return Json(new
                            {
                                value = JsonSerializer.SerializeToElement(State, WorkflowContract.Json)
                            });
                        }

                        return Deliveries.TryGetValue(key, out TaskDelivery? delivery) ? Json(new
                        {
                            value = JsonSerializer.SerializeToElement(delivery, WorkflowContract.Json)
                        }) : new HttpResponseMessage(HttpStatusCode.NotFound);
                    }

                    PlannedTask? task = State.Plan!.Tasks.FirstOrDefault(task => State.Created.Any(item => item.Id == task.Id && item.Key == key));
                    string stable = task?.Id == "art-requirements" ? "art" : "early";
                    string label = "gamecli-task-" + WorkflowContract.Hash(State.Id + "\n" + stable + "\n" + task?.Id)[..32];
                    return Json(new
                    {
                        key,
                        fields = new
                        {
                            project = new
                            {
                                key = "GAME"
                            },
                            description = "测试单据",
                            labels = new[]
                            {
                                label
                            },
                            issuetype = new
                            {
                                subtask = key != "GAME-1"
                            },
                            parent = new
                            {
                                key = "GAME-1"
                            },
                            status = new
                            {
                                statusCategory = new
                                {
                                    key = Done.Contains(key) ? "done" : "new"
                                }
                            },
                            updated = DateTimeOffset.UtcNow.ToString("O")
                        }
                    });
                }

                if (request.Method == HttpMethod.Post && parts[5] == "transitions")
                {
                    TransitionCalls++;
                    Require(Deliveries[key].CompletionRequested && Deliveries[key].Status == "submitted", "Transition intent must be durable first.");
                    if (TransitionFault == "transition-rejected")
                    {
                        return new HttpResponseMessage(HttpStatusCode.BadRequest)
                        {
                            Content = new StringContent("{}", Encoding.UTF8, "application/json")
                        };
                    }

                    if (TransitionFault != "transition-unknown")
                    {
                        Done.Add(key);
                    }

                    if (TransitionFault != "")
                    {
                        throw new HttpRequestException("模拟完成转换响应丢失");
                    }

                    return new HttpResponseMessage(HttpStatusCode.NoContent);
                }

                Require(request.Method == HttpMethod.Put, "Unexpected mutation");
                using JsonDocument body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
                TaskDelivery saved = WorkflowContract.Parse<TaskDelivery>(body.RootElement.GetProperty("properties")[0].GetProperty("value").GetRawText());
                Deliveries[key] = saved;
                if (FailIntent || LoseSubmission && saved.Status == "submitted")
                {
                    throw new HttpRequestException("模拟响应丢失");
                }

                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }

            private static HttpResponseMessage Json(object value)
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json")
                };
            }
        }
    }
}
