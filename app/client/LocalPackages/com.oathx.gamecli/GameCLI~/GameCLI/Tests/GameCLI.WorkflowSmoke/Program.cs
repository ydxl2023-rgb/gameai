using System.Net;
using System.Text;
using System.Text.Json;

using GameCLI.Agents;
using GameCLI.Contracts;
using GameCLI.Core;
using GameCLI.Services;

namespace GameCLI.WorkflowSmoke
{
    internal static class Program
    {
        private static readonly TaskPlan plan = new(new[]
        {
            new PlannedTask("art-requirements", "Art", "背包图标", "制作图标", new[]
            {
                "图标可导入"
            }, Array.Empty<string>()),
            new PlannedTask("dev", "Development", "背包功能", "实现背包", new[]
            {
                "容量为十格"
            }, new[]
            {
                "art-requirements"
            }),
            new PlannedTask("qa", "QA", "背包验收", "测试背包", new[]
            {
                "验证容量"
            }, new[]
            {
                "dev"
            })
        });

        private static readonly DesignBrief design = new("背包", "容量十格，不能堆叠", new[]
        {
            "第十一个物品无法放入"
        }, new[]
        {
            "背包图标"
        }, new[]
        {
            "背包逻辑"
        }, Array.Empty<string>());

        private static async Task<int> Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "app-server")
            {
                await FakeServerAsync();
                return 0;
            }

            string root = Path.GetFullPath(args[0]);
            string formatted = JiraIssueDescription.Workflow(new Workflow
            {
                Design = design with
                {
                    Acceptance = new[]
                    {
                        "前置条件：背包为空；操作：打开背包；预期：显示 20 格"
                    },
                    Questions = new[]
                    {
                        "待澄清问题不能写入正文"
                    }
                }
            });
            Require(!formatted.Contains("待澄清") && formatted.Contains("** 前置条件") && formatted.Contains("*** 背包为空") && formatted.Contains("** 操作步骤") && !formatted.Contains("；操作"), "Test case hierarchy or private question boundary failed.");
            string skills = Path.Combine(root, "app/client/LocalPackages/com.oathx.gamecli/game-cli");
            if (args.Contains("--professional-only"))
            {
                foreach (string role in new[]
                {
                    "Art",
                    "Development",
                    "QA"
                })
                {
                    Environment.SetEnvironmentVariable("GAMECLI_WORKFLOW_MODE", "professional-" + role);
                    CodexWorkflowAgent worker = new(Environment.ProcessPath!, root, skills, null);
                    using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(15));
                    string output = await worker.RunAsync(role, "测试专业协议，不执行实际制作。", TaskDelivery.ResultSchema, Guid.NewGuid().ToString("N"), null, (_, _, _) => Task.CompletedTask, deadline.Token);
                    Require(WorkflowContract.Parse<DeliveryResult>(output).Verdict == "blocked", "Professional result protocol failed.");
                    Console.WriteLine("PASS professional-" + role);
                }

                return 0;
            }

            if (args.Contains("--real-codex"))
            {
                using FakeJira handler = new();
                using HttpClient http = new(handler);
                JiraWorkflowStore store = new(http, new JiraConnection("https://jira.test", "GAME", "fake-secret"), () =>
                {
                }, null);
                CodexWorkflowAgent agent = new("codex", root, skills, null);
                RequirementWorkflow workflow = new(store, agent, _ =>
                {
                });
                using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(300));
                Workflow state = await workflow.StartAsync("开发 Unity 2022.3 Windows 单机原型。唯一需求：启动后屏幕中央显示固定英文 HELLO，白色文字黑色背景，使用 Unity 内置字体。无交互、无存档、无网络、无美术资产需求，不做其他功能。验收：启动进入画面后能看见且只看见 HELLO，无运行错误。以上为完整测试需求，其他表现使用 Unity 默认值。", deadline.Token);
                Require(state.Stage == "awaiting_approval", "Real Design did not produce a reviewable result.");
                Workflow done = await workflow.ApproveAsync(state.IssueKey, state.Revision, deadline.Token);
                Require(done.Stage == "tasks_created" && done.Created.Count >= 2, "Real PM did not publish tasks through the fake JIRA transport.");
                Console.WriteLine("REAL_CODEX_FAKE_JIRA_PASSED " + done.Created.Count);
                return 0;
            }

            foreach (string mode in new[]
            {
                "success",
                "questions",
                "wrong-revision",
                "disabled",
                "lost-response",
                "index-delay",
                "no-tool",
                "wrong-thread",
                "cycle",
                "revise",
                "cancel",
                "bootstrap",
                "early-lost",
                "early-disabled",
                "no-art",
                "mobile-invalid"
            })
            {
                Environment.SetEnvironmentVariable("GAMECLI_WORKFLOW_MODE", mode);
                using FakeJira httpHandler = new();
                using HttpClient http = new(httpHandler);
                JiraWorkflowStore store = new(http, new JiraConnection("https://jira.test", "GAME", "fake-secret"), () =>
                {
                }, null);
                CodexWorkflowAgent agent = new(Environment.ProcessPath!, root, skills, null);
                bool disabled = false;
                RequirementWorkflow workflow = new(store, agent, role =>
                {
                    if (disabled && role == "pm")
                    {
                        throw new JiraTaskException("Disabled PM.", 3);
                    }
                });
                using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(25));
                CancellationToken token = timeout.Token;
                if (mode is "early-lost" or "lost-response" or "index-delay")
                {
                    httpHandler.LoseResponse = true;
                    httpHandler.LoseOnChild = mode == "lost-response" ? 2 : mode == "index-delay" ? 3 : 1;
                    await ExpectFailureAsync(() => workflow.StartAsync("背包需求", token));
                    Require(httpHandler.ChildPosts == httpHandler.LoseOnChild, "Expected publication was not attempted.");
                    httpHandler.HideSearch = true;
                    await ExpectFailureAsync(() => workflow.ResumeAsync(store.LastCreatedIssueKey!, token));
                    Require(httpHandler.ChildPosts == httpHandler.LoseOnChild, "Unknown outcome caused duplicate POST.");
                    httpHandler.HideSearch = false;
                    Workflow recovered = await workflow.ResumeAsync(store.LastCreatedIssueKey!, token);
                    await workflow.ResumeAsync(recovered.IssueKey, token);
                    Require(recovered.ArtCreated != null && !recovered.ArtPending && recovered.ApprovedRevision == null && recovered.EarlyTasks.Count == 2 && httpHandler.ChildPosts == 3, "Art recovery failed.");
                    Console.WriteLine("PASS " + mode);
                    continue;
                }

                if (mode == "early-disabled")
                {
                    disabled = true;
                    await ExpectFailureAsync(() => workflow.StartAsync("背包需求", token));
                    Require(httpHandler.ChildPosts == 0, "Disabled PM registered art.");
                    disabled = false;
                    Workflow recovered = await workflow.ResumeAsync(store.LastCreatedIssueKey!, token);
                    Require(recovered.ArtCreated != null && recovered.EarlyTasks.Count == 2 && httpHandler.ChildPosts == 3, "Art did not resume after enabling PM.");
                    Console.WriteLine("PASS " + mode);
                    continue;
                }

                if (mode == "mobile-invalid")
                {
                    await ExpectFailureAsync(() => workflow.StartAsync("背包需求", token));
                    Require(httpHandler.ChildPosts == 0, "Desktop design registered art.");
                    Console.WriteLine("PASS " + mode);
                    continue;
                }

                if (mode == "no-art")
                {
                    Workflow withoutArt = await workflow.StartAsync("背包需求", token);
                    Require(withoutArt.ArtCreated == null && withoutArt.EarlyTasks.Count == 2 && httpHandler.ChildPosts == 2, "Absent art scope still created an issue.");
                    Console.WriteLine("PASS " + mode);
                    continue;
                }

                if (mode == "cancel")
                {
                    timeout.CancelAfter(400);
                    await ExpectFailureAsync(() => workflow.StartAsync("背包需求", token));
                    Require(httpHandler.ChildPosts == 0, "Cancellation published tasks.");
                    Console.WriteLine("PASS " + mode);
                    continue;
                }

                if (mode == "bootstrap")
                {
                    httpHandler.FailProperty = true;
                    await ExpectFailureAsync(() => workflow.StartAsync("背包需求", token));
                    Require(store.LastCreatedIssueKey != null, "Missing recovery key.");
                    httpHandler.FailProperty = false;
                    Workflow resumed = await workflow.ResumeAsync(store.LastCreatedIssueKey!, token);
                    Require(resumed.Stage == "awaiting_approval" && httpHandler.RootPosts == 1, "Bootstrap recovery failed.");
                    Console.WriteLine("PASS " + mode);
                    continue;
                }

                Workflow state = await workflow.StartAsync("背包需求", token);
                Require(httpHandler.RootPosts == 1 && httpHandler.ChildPosts == 3 && state.ArtCreated != null && state.EarlyTasks.Count == 2 && state.ApprovedRevision == null, "Design must immediately register art without approving development.");
                if (mode == "questions")
                {
                    Require(state.Stage == "needs_clarification", "Questions must block approval.");
                    await ExpectFailureAsync(() => workflow.ApproveAsync(state.IssueKey, state.Revision, token));
                }
                else if (mode == "wrong-revision")
                {
                    await ExpectFailureAsync(() => workflow.ApproveAsync(state.IssueKey, "stale", token));
                    Workflow waiting = await workflow.ResumeAsync(state.IssueKey, token);
                    Require(waiting.Stage == "awaiting_approval" && httpHandler.ChildPosts == 3, "Resume bypassed approval.");
                }
                else if (mode == "revise")
                {
                    Workflow updated = await workflow.ReviseAsync(state.IssueKey, "更新的背包需求", token);
                    Require(updated.Revision != state.Revision && updated.ApprovedRevision == null && updated.ArtCreated!.Key == state.ArtCreated!.Key && httpHandler.ChildPosts == 3, "Revision did not invalidate approval.");
                    await ExpectFailureAsync(() => workflow.ApproveAsync(state.IssueKey, state.Revision, token));
                }
                else
                {
                    disabled = mode == "disabled";
                    httpHandler.LoseResponse = mode is "lost-response" or "index-delay";
                    if (mode == "success")
                    {
                        Workflow done = await workflow.ApproveAsync(state.IssueKey, state.Revision, token);
                        Require(done.Stage == "tasks_created" && done.Created.Count == 3 && httpHandler.ChildPosts == 3, "Missing tasks.");
                        Require(done.Executions.Select(item => item.Role).SequenceEqual(new[]
                        {
                            "Design",
                            "PM"
                        }), "Roles not separated.");
                        Require(done.Executions.Select(item => item.ThreadId).Distinct().Count() == 2, "Agent threads reused.");
                        await workflow.ResumeAsync(state.IssueKey, token);
                        Require(httpHandler.ChildPosts == 3, "Completed resume duplicated tasks.");
                        await workflow.StartAsync("背包需求", token);
                        Require(httpHandler.RootPosts == 1 && httpHandler.ChildPosts == 3, "Repeated start duplicated the workflow.");
                    }
                    else
                    {
                        await ExpectFailureAsync(() => workflow.ApproveAsync(state.IssueKey, state.Revision, token));
                        if (mode is "lost-response" or "index-delay")
                        {
                            Require(httpHandler.ChildPosts == 2, "Lost POST repeated.");
                            if (mode == "index-delay")
                            {
                                httpHandler.HideSearch = true;
                                await ExpectFailureAsync(() => workflow.ResumeAsync(state.IssueKey, token));
                                Require(httpHandler.ChildPosts == 2, "Index delay caused duplicate POST.");
                                httpHandler.HideSearch = false;
                            }

                            Workflow done = await workflow.ResumeAsync(state.IssueKey, token);
                            Require(done.Stage == "tasks_created" && httpHandler.ChildPosts == 3, "Partial recovery failed.");
                        }
                        else
                        {
                            Require(httpHandler.ChildPosts == 3, "Invalid execution published development or duplicated art.");
                        }
                    }
                }

                Console.WriteLine("PASS " + mode);
            }

            Environment.SetEnvironmentVariable("GAMECLI_WORKFLOW_MODE", null);
            Console.WriteLine("WORKFLOW_SMOKE_PASSED");
            return 0;
        }

        private static async Task ExpectFailureAsync(Func<Task<Workflow>> operation)
        {
            try
            {
                await operation();
            }
            catch (Exception exception) when (exception is JiraTaskException or CodexInteractionException or JsonException or OperationCanceledException or IOException or InvalidOperationException)
            {
                return;
            }

            throw new Exception("Expected a guarded failure.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition)
            {
                throw new Exception(message);
            }
        }

        private static async Task FakeServerAsync()
        {
            string? mode = Environment.GetEnvironmentVariable("GAMECLI_WORKFLOW_MODE");
            Array.Copy(EarlyTaskPublisher.BuildTasks(design), plan.Tasks, 3);
            bool pm = false;
            string thread = Guid.NewGuid().ToString("N");
            string turn = Guid.NewGuid().ToString("N");
            while (await Console.In.ReadLineAsync() is string line)
            {
                using JsonDocument message = JsonDocument.Parse(line);
                JsonElement root = message.RootElement;
                if (!root.TryGetProperty("id", out JsonElement id))
                {
                    continue;
                }

                if (!root.TryGetProperty("method", out JsonElement method))
                {
                    Require(root.GetProperty("result").GetProperty("success").GetBoolean(), "Tool failed.");
                    string text = root.GetProperty("result").GetProperty("contentItems")[0].GetProperty("text").GetString()!;
                    using JsonDocument result = JsonDocument.Parse(text);
                    Require(result.RootElement.GetProperty("tasks").GetArrayLength() == 3, "Tool omitted results.");
                    Complete(thread, turn, "{\"status\":\"success\",\"summary\":\"created\"}");
                    continue;
                }

                switch (method.GetString())
                {
                    case "initialize":
                        Require(root.GetProperty("params").GetProperty("capabilities").GetProperty("experimentalApi").GetBoolean(), "Experimental API not enabled.");
                        Send(new
                    {
                        id = id.Clone(),
                        result = new {}
                    });
                        break;
                    case "config/read":
                        Send(new
                    {
                        id = id.Clone(),
                        result = new
                        {
                            config = new
                            {
                                mcp_servers = new
                                {
                                    external = new
                                    {
                                        enabled = true
                                    }
                                }
                            }
                        }
                    });
                        break;
                    case "thread/start":
                        JsonElement parameters = root.GetProperty("params");
                        Require(!parameters.GetProperty("config").GetProperty("mcp_servers.external.enabled").GetBoolean(), "Inherited MCP not disabled.");
                        bool professional = mode?.StartsWith("professional-", StringComparison.Ordinal) == true;
                        Require(parameters.GetProperty("sandbox").GetString() == (professional ? "workspace-write" : "read-only"), "Invalid sandbox.");
                        Require(parameters.GetProperty("config").GetProperty("features.shell_tool").GetBoolean() == professional, "Invalid shell capability.");
                        Require(!parameters.GetProperty("config").GetProperty("sandbox_workspace_write.network_access").GetBoolean(), "Unexpected network access.");
                        Require(parameters.GetProperty("developerInstructions").GetString()!.Contains("# 任务依赖与交付"), "Missing delivery skill.");
                        if (mode == "professional-Development")
                        {
                            Require(parameters.GetProperty("developerInstructions").GetString()!.Contains("# Dev Agent"), "Development skill mapping failed.");
                        }

                        pm = parameters.GetProperty("developerInstructions").GetString()!.Contains("# PM Agent");
                        Require(parameters.GetProperty("dynamicTools").GetArrayLength() == (pm ? 1 : 0), "Wrong role tools.");
                        Send(new
                    {
                        id = id.Clone(),
                        result = new
                        {
                            thread = new
                            {
                                id = thread
                            }
                        }
                    });
                        break;
                    case "turn/start":
                        Send(new
                    {
                        id = id.Clone(),
                        result = new
                        {
                            turn = new
                            {
                                id = turn
                            }
                        }
                    });
                        if (mode == "cancel")
                        {
                            break;
                        }

                        if (mode?.StartsWith("professional-", StringComparison.Ordinal) == true)
                        {
                            Complete(thread, turn, WorkflowContract.Serialize(new DeliveryResult("blocked", "模拟协议测试，未制作实际产物。", Array.Empty<DeliveryArtifact>(), Array.Empty<DeliveryCheck>())));
                            break;
                        }

                        if (!pm)
                        {
                            if (mode == "mobile-invalid")
                            {
                                Complete(thread, turn, WorkflowContract.Serialize(design with
                            {
                                Specification = "使用右键菜单丢弃物品"
                            }));
                                break;
                            }

                            if (mode == "no-art")
                            {
                                Complete(thread, turn, WorkflowContract.Serialize(design with
                            {
                                ArtRequirements = Array.Empty<string>()
                            }));
                                break;
                            }

                            Complete(thread, turn, WorkflowContract.Serialize(mode == "questions" ? design with
                        {
                            Questions = new[]
                            {
                                "容量是多少？"
                            }
                        } : design));
                        }
                        else if (mode == "no-tool")
                        {
                            Complete(thread, turn, "{\"status\":\"success\",\"summary\":\"fake success\"}");
                        }
                        else
                        {
                            TaskPlan submitted = mode == "cycle" ? new TaskPlan(new[]
                        {
                            plan.Tasks[0] with
                            {
                                DependsOn = new[]
                                {
                                    "qa"
                                }
                            },
                            plan.Tasks[1],
                            plan.Tasks[2]
                        }) : plan;
                            Send(new
                        {
                            id = "tool-1",
                            method = "item/tool/call",
                            @params = new
                            {
                                threadId = mode == "wrong-thread" ? "other" : thread,
                                turnId = turn,
                                callId = "call-1",
                                tool = "jira_publish_tasks",
                                arguments = JsonSerializer.Deserialize<JsonElement>(WorkflowContract.Serialize(submitted))
                            }
                        });
                        }

                        break;
                    case "turn/interrupt":
                        Send(new
                    {
                        id = id.Clone(),
                        result = new {}
                    });
                        break;
                }
            }
        }

        private static void Complete(string thread, string turn, string text)
        {
            Send(new
            {
                method = "item/completed",
                @params = new
                {
                    threadId = thread,
                    turnId = turn,
                    item = new
                    {
                        type = "agentMessage",
                        phase = "final_answer",
                        text
                    }
                }
            });
            Send(new
            {
                method = "turn/completed",
                @params = new
                {
                    threadId = thread,
                    turn = new
                    {
                        id = turn,
                        status = "completed"
                    }
                }
            });
        }

        private static void Send(object message)
        {
            Console.WriteLine(JsonSerializer.Serialize(message));
        }

        private sealed class FakeJira : HttpMessageHandler
        {
            private readonly Dictionary<string, JsonElement> issues = new();

            private readonly Dictionary<string, string> properties = new();

            public int RootPosts
            { get; private set; }

            public int ChildPosts
            { get; private set; }

            public int LoseOnChild
            { get; set; } = 1;

            public bool LoseResponse
            { get; set; }

            public bool HideSearch
            { get; set; }

            public bool FailProperty
            { get; set; }

            /// <inheritdoc />
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                Require(request.Headers.Authorization?.Parameter == "fake-secret", "Missing auth.");
                string path = request.RequestUri!.AbsolutePath.Replace("/rest/api/2/", "");
                if (path == "project/GAME")
                {
                    return Response(new
                    {
                        key = "GAME",
                        issueTypes = new[]
                        {
                            new
                            {
                                id = "1",
                                name = "Task",
                                subtask = false
                            },
                            new
                            {
                                id = "2",
                                name = "子任务",
                                subtask = true
                            }
                        }
                    });
                }

                if (path == "myself")
                {
                    return Response(new
                    {
                        key = "human-user"
                    });
                }

                if (path == "issue" && request.Method == HttpMethod.Post)
                {
                    string body = await request.Content!.ReadAsStringAsync(cancellationToken);
                    using JsonDocument document = JsonDocument.Parse(body);
                    JsonElement fields = document.RootElement.GetProperty("fields").Clone();
                    string key = "GAME-" + (issues.Count + 1);
                    bool isRoot = fields.GetProperty("labels").EnumerateArray().Any(label => label.GetString() == "gamecli-workflow");
                    Require(fields.GetProperty("issuetype").GetProperty("id").GetString() == (isRoot ? "1" : "2"), "Wrong task hierarchy type.");
                    Require(isRoot ? !fields.TryGetProperty("parent", out _) : fields.GetProperty("parent").GetProperty("key").GetString() == "GAME-1", "Wrong parent issue.");
                    Dictionary<string, JsonElement> stored = fields.EnumerateObject().ToDictionary(field => field.Name, field => field.Value.Clone());
                    stored["issuetype"] = JsonSerializer.SerializeToElement(new
                    {
                        id = isRoot ? "1" : "2",
                        subtask = !isRoot
                    });
                    issues.Add(key, JsonSerializer.SerializeToElement(stored));
                    string description = fields.GetProperty("description").GetString()!;
                    Require(!description.Contains("GAMECLI_WORKFLOW_BOOTSTRAP") && !description.Contains("Acceptance:") && !description.Contains("Workflow:"), "Machine state or English prose leaked into description.");
                    Require(description.Contains("h3. 开发内容与规则") && description.Contains("* "), "Missing Chinese content list.");
                    if (isRoot)
                    {
                        properties[key] = document.RootElement.GetProperty("properties")[0].GetProperty("value").GetRawText();
                        RootPosts++;
                    }
                    else
                    {
                        ChildPosts++;
                        if (LoseResponse && ChildPosts == LoseOnChild)
                        {
                            LoseResponse = false;
                            throw new HttpRequestException("Simulated response loss after commit.");
                        }
                    }

                    return Response(new
                    {
                        key
                    }, HttpStatusCode.Created);
                }

                if (path == "search")
                {
                    string query = Uri.UnescapeDataString(request.RequestUri.Query);
                    object[] found = HideSearch ? Array.Empty<object>() : issues.Where(pair => pair.Value.GetProperty("labels").EnumerateArray().Any(label => query.Contains("\"" + label.GetString() + "\"", StringComparison.Ordinal))).Select(pair => (object)new
                    {
                        key = pair.Key
                    }).ToArray();
                    return Response(new
                    {
                        total = found.Length,
                        issues = found
                    });
                }

                string[] parts = path.Split('/');
                if (parts.Length == 4 && parts[2] == "properties")
                {
                    if (request.Method == HttpMethod.Put)
                    {
                        if (FailProperty)
                        {
                            return Response(new {}, HttpStatusCode.Forbidden);
                        }

                        properties[parts[1]] = await request.Content!.ReadAsStringAsync(cancellationToken);
                        return Response(new {}, HttpStatusCode.OK);
                    }

                    return properties.TryGetValue(parts[1], out string? value) ? Response(new
                    {
                        value = JsonSerializer.Deserialize<JsonElement>(value)
                    }) : Response(new {}, HttpStatusCode.NotFound);
                }

                if (parts.Length == 2 && issues.TryGetValue(parts[1], out JsonElement issue))
                {
                    if (request.Method == HttpMethod.Put)
                    {
                        if (FailProperty)
                        {
                            return Response(new {}, HttpStatusCode.Forbidden);
                        }

                        using JsonDocument update = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
                        Dictionary<string, JsonElement> fields = issue.EnumerateObject().ToDictionary(field => field.Name, field => field.Value.Clone());
                        foreach (JsonProperty field in update.RootElement.GetProperty("fields").EnumerateObject())
                        {
                            fields[field.Name] = field.Value.Clone();
                        }

                        if (!update.RootElement.TryGetProperty("properties", out JsonElement updates))
                        {
                            issues[parts[1]] = JsonSerializer.SerializeToElement(fields);
                            return Response(new {}, HttpStatusCode.NoContent);
                        }

                        JsonElement state = updates[0].GetProperty("value");
                        if (state.GetProperty("design").ValueKind != JsonValueKind.Null)
                        {
                            Require(fields["description"].GetString()!.Contains("测试用例与验收标准"), "Design projection was not refreshed.");
                        }

                        issues[parts[1]] = JsonSerializer.SerializeToElement(fields);
                        properties[parts[1]] = state.GetRawText();
                        return Response(new {}, HttpStatusCode.NoContent);
                    }

                    return Response(new
                    {
                        key = parts[1],
                        fields = issue
                    });
                }

                throw new Exception("Unexpected HTTP " + request.Method + " " + path);
            }

            private static HttpResponseMessage Response(object body, HttpStatusCode status = HttpStatusCode.OK)
            {
                return new HttpResponseMessage(status)
                {
                    Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
                };
            }
        }
    }
}
