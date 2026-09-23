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
        private static async Task Main()
        {
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

        private static async Task RejectAsync(Func<Task<GateReport>> action, string message)
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

        private sealed class FakeJira : HttpMessageHandler
        {
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
