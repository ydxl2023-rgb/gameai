using System.Net;
using System.Text;
using System.Text.Json;

using GameCLI.Services;

namespace GameCLI.JiraSmoke
{
    internal static class Program
    {
        private static async Task Main()
        {
            foreach (string mode in new[]
            {
                "success",
                "localized",
                "type-override",
                "no-task",
                "forbidden",
                "required-field",
                "redirect",
                "lost-response",
                "timeout",
                "bad-success",
                "server-error",
                "invalid-input",
                "subtask",
                "wrong-parent",
                "nested-parent",
                "no-subtask"
            })
            {
                using FakeHandler handler = new FakeHandler(mode);
                using HttpClient http = new HttpClient(handler);
                try
                {
                    JiraTaskResult result = await new JiraTaskClient(http).CreateAsync("https://jira.example.test/jira", "test-secret", " GAI ", mode == "invalid-input" ? " " : "任务 \"测试\"", "First line\n第二行", mode == "type-override" ? "9" : null, CancellationToken.None, parentKey: mode is "subtask" or "wrong-parent" or "nested-parent" or "no-subtask" ? "GAI-1" : null);
                    Require(mode is "success" or "localized" or "type-override" or "subtask", "unexpected success");
                    Require(result.Key == "GAI-42" && result.Url == "https://jira.example.test/jira/browse/GAI-42", "result identity");
                }
                catch (JiraTaskException exception)
                {
                    bool unknown = mode is "lost-response" or "timeout" or "bad-success" or "server-error";
                    Require(exception.OutcomeUnknown == unknown, "uncertain POST outcome");
                    Require(mode is not ("success" or "localized" or "type-override" or "subtask" or "invalid-input"), "unexpected failure");
                    Require(!exception.Message.Contains("test-secret", StringComparison.Ordinal), "credential redaction");
                    if (mode == "required-field")
                    {
                        Require(exception.ExitCode == 2 && exception.Message.Contains("customfield_10001", StringComparison.Ordinal), "required field feedback");
                    }
                }
                catch (ArgumentException) when (mode == "invalid-input")
                {
                    Require(handler.Requests == 0, "validate before HTTP");
                }

                int expectedPosts = mode is "no-task" or "forbidden" or "invalid-input" or "wrong-parent" or "nested-parent" or "no-subtask" ? 0 : 1;
                Require(handler.Posts == expectedPosts, "no retries or premature creation");
                Console.WriteLine("PASS " + mode);
            }

            Console.WriteLine("JIRA_SMOKE_PASSED (fake HTTP; no remote issues created)");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition)
            {
                throw new Exception(message);
            }
        }

        private sealed class FakeHandler : HttpMessageHandler
        {
            private readonly string mode;

            public int Requests
            { get; private set; }

            public int Posts
            { get; private set; }

            public FakeHandler(string mode)
            {
                this.mode = mode;
            }

            /// <inheritdoc />
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                Requests++;
                Require(request.Headers.Authorization?.Scheme == "Bearer", "Bearer authentication");
                if (request.Method == HttpMethod.Get)
                {
                    if (request.RequestUri?.AbsolutePath == "/jira/rest/api/2/issue/GAI-1")
                    {
                        return Reply(HttpStatusCode.OK, JsonSerializer.Serialize(new
                        {
                            key = "GAI-1",
                            fields = new
                            {
                                project = new
                                {
                                    key = mode == "wrong-parent" ? "OTHER" : "GAI"
                                },
                                issuetype = new
                                {
                                    subtask = mode == "nested-parent"
                                }
                            }
                        }));
                    }

                    Require(request.RequestUri?.AbsolutePath == "/jira/rest/api/2/project/GAI", "project and context path");
                    if (mode == "forbidden")
                    {
                        return Reply(HttpStatusCode.Forbidden, "{}");
                    }

                    string name = mode == "localized" ? "任务" : mode is "no-task" or "type-override" ? "Custom Work" : "Task";
                    return Reply(HttpStatusCode.OK, JsonSerializer.Serialize(new
                    {
                        key = "GAI",
                        issueTypes = new[]
                        {
                            new
                            {
                                id = "8",
                                name = "Task",
                                subtask = mode != "no-subtask"
                            },
                            new
                            {
                                id = "9",
                                name,
                                subtask = false
                            }
                        }
                    }));
                }

                Posts++;
                Require(request.Method == HttpMethod.Post && request.RequestUri?.AbsolutePath == "/jira/rest/api/2/issue", "creation route");
                using JsonDocument payload = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
                JsonElement fields = payload.RootElement.GetProperty("fields");
                Require(fields.GetProperty("project").GetProperty("key").GetString() == "GAI", "canonical project key");
                Require(fields.GetProperty("issuetype").GetProperty("id").GetString() == (mode == "subtask" ? "8" : "9"), "issue type selection");
                Require(mode == "subtask" ? fields.GetProperty("parent").GetProperty("key").GetString() == "GAI-1" : !fields.TryGetProperty("parent", out _), "parent linkage");
                Require(fields.GetProperty("summary").GetString() == "任务 \"测试\"", "Unicode and quote escaping");
                Require(fields.GetProperty("description").GetString() == "First line\n第二行", "description preservation");
                if (mode == "lost-response")
                {
                    throw new HttpRequestException("Connection lost after submission");
                }

                if (mode == "timeout")
                {
                    throw new OperationCanceledException();
                }

                return mode switch
                {
                    "required-field" => Reply(HttpStatusCode.BadRequest, "{\"errors\":{\"customfield_10001\":\"Required test-secret\"}}"),
                    "redirect" => Reply(HttpStatusCode.Redirect, "<html>Login</html>"),
                    "bad-success" => Reply(HttpStatusCode.Created, "not JSON"),
                    "server-error" => Reply(HttpStatusCode.InternalServerError, "{}"),
                    _ => Reply(HttpStatusCode.Created, "{\"id\":\"42\",\"key\":\"GAI-42\"}")
                };
            }

            private static HttpResponseMessage Reply(HttpStatusCode status, string json)
            {
                return new HttpResponseMessage(status)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
            }
        }
    }
}
