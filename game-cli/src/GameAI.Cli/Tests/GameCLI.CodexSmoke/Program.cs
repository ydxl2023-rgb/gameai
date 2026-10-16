using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

using GameCLI.Abstractions;
using GameCLI.Contracts;
using GameCLI.Core;
using GameCLI.Plugins.PM;
using GameCLI.Services;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "app-server")
        {
            await FakeServerAsync();
            return 0;
        }

        string root = Path.GetFullPath(args[0]);
        await using FakeCloud cloud = new();
        foreach ((string mode, int expected) in new[]
        {
            ("success", 0),
            ("cycle", 2),
            ("missing", 2),
            ("bad-json", 2),
            ("blocked", 3),
            ("failed-turn", 3),
            ("input-too-large", 3),
            ("request", 3),
            ("eof", 1),
            ("stall", 1)
        })
        {
            Environment.SetEnvironmentVariable("GAMECLI_FAKE_MODE", mode);
            TextWriter originalOut = Console.Out;
            TextWriter originalError = Console.Error;
            using StringWriter output = new();
            using StringWriter error = new();
            int code;
            try
            {
                Console.SetOut(output);
                Console.SetError(error);
                PluginHost host = new(new ICLIPlugin[]
                {
                    new PMPlugin()
                }, new PluginSettingsStore(Path.Combine(Path.GetTempPath(), "gamecli-smoke-" + Guid.NewGuid().ToString("N"), "plugins.json")));
                code = await host.RunAsync(new[]
                {
                    "pm",
                    "--analyze",
                    "--project",
                    cloud.Project,
                    "--skills",
                    Path.Combine(root, "game-cli", "skills"),
                    "--key",
                    "TEST-PM",
                    "--prompt",
                    "A test requirement",
                    "--codex",
                    Environment.ProcessPath ?? throw new Exception("No executable"),
                    "--timeout",
                    mode == "stall" ? "2" : "15",
                    "--format",
                    "json"
                });
            }
            finally
            {
                Console.SetOut(originalOut);
                Console.SetError(originalError);
            }

            using JsonDocument result = JsonDocument.Parse(output.ToString());
            if (code != expected || result.RootElement.GetProperty("ok").GetBoolean() != (expected == 0))
            {
                throw new Exception(mode + " expected " + expected + " got " + code + ": " + output + error);
            }

            Console.WriteLine("PASS " + mode);
            if (mode == "input-too-large" && (!output.ToString().Contains("CODEX_INPUT_TOO_LARGE") || output.ToString().Contains("PRIVATE_PROVIDER_TEXT")))
            {
                throw new Exception("Input size diagnostics must retain counts without provider text.");
            }
        }

        Environment.SetEnvironmentVariable("GAMECLI_FAKE_MODE", "plan");
        string promptFile = Path.Combine(cloud.Project, "approved.txt");
        await File.WriteAllTextAsync(promptFile, "已批准的测试 HTML");
        string planExecution = Guid.NewGuid().ToString("N");
        TextWriter planOriginalOut = Console.Out;
        using StringWriter planOutput = new();
        try
        {
            Console.SetOut(planOutput);
            PluginHost planHost = new(new ICLIPlugin[]
            {
                new PMPlugin()
            }, new PluginSettingsStore(Path.Combine(cloud.Project, "plugins.json")));
            int planCode = await planHost.RunAsync(new[]
            {
                "pm",
                "plan",
                "--project",
                cloud.Project,
                "--key",
                "TEST-PM",
                "--execution-id",
                planExecution,
                "--prompt-file",
                promptFile,
                "--skills",
                Path.Combine(root, "game-cli", "skills"),
                "--codex",
                Environment.ProcessPath ?? throw new Exception("No executable")
            });
            using JsonDocument result = JsonDocument.Parse(planOutput.ToString());
            if (planCode != 0 || result.RootElement.GetProperty("execution_id").GetString() != planExecution || result.RootElement.GetProperty("plan").GetProperty("tasks")[0].GetProperty("role").GetString() != "Art")
            {
                throw new Exception("PM plan protocol failed: " + planOutput);
            }
        }
        finally
        {
            Console.SetOut(planOriginalOut);
        }

        Console.WriteLine("PASS cloud PM plan proposal");
        Environment.SetEnvironmentVariable("GAMECLI_FAKE_MODE", "design-question");
        ProcessStartInfo child = new("dotnet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = new UTF8Encoding(false, true),
            StandardErrorEncoding = new UTF8Encoding(false, true),
            UseShellExecute = false,
            CreateNoWindow = true
        };
        foreach (string argument in new[]
        {
            Path.Combine(root, "game-cli/src/GameAI.Cli/GameCLI/bin/Release/net8.0/GameCLI.dll"),
            "design", "draft", "--project", cloud.Project, "--key", "TEST-PM",
            "--prompt-file", promptFile, "--version", "v2", "--skills", Path.Combine(root, "game-cli/skills"),
            "--codex", Environment.ProcessPath!, "--timeout", "15"
        })
        {
            child.ArgumentList.Add(argument);
        }
        using Process process = Process.Start(child)!;
        Task<string> stdout = process.StandardOutput.ReadToEndAsync();
        Task<string> stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        using JsonDocument question = JsonDocument.Parse(await stdout);
        if (process.ExitCode != 3 || question.RootElement.GetProperty("questions")[0].GetString() != "请确认新版规范：控件数量为26。")
        {
            throw new Exception("Redirected Design UTF-8 response failed: " + await stderr);
        }
        Console.WriteLine("PASS resumed Design current skills and redirected UTF-8 questions");
        Environment.SetEnvironmentVariable("GAMECLI_FAKE_MODE", null);
        Console.WriteLine("CODEX_PROTOCOL_SMOKE_PASSED");
        return 0;
    }

    private static async Task FakeServerAsync()
    {
        string? mode = Environment.GetEnvironmentVariable("GAMECLI_FAKE_MODE");
        string? currentSnapshot = null;
        while (await Console.In.ReadLineAsync() is string line)
        {
            using JsonDocument document = JsonDocument.Parse(line);
            JsonElement message = document.RootElement;
            string? method = message.GetProperty("method").GetString();
            if (!message.TryGetProperty("id", out JsonElement id))
            {
                continue;
            }

            if (mode == "eof")
            {
                return;
            }

            if (method == "initialize")
            {
                Send(new
                {
                    id = id.Clone(),
                    result = new {}
                });
            }
            else if (method is "thread/start" or "thread/resume")
            {
                JsonElement p = message.GetProperty("params");
                if (method == "thread/resume" && p.GetProperty("threadId").GetString() != "thread-test")
                {
                    throw new Exception("Original conversation was not resumed");
                }
                currentSnapshot = p.GetProperty("developerInstructions").GetString();
                if (p.GetProperty("sandbox").GetString() != "read-only" || (mode != "design-question" && !currentSnapshot!.Contains("RodFergusson")))
                {
                    throw new Exception("Missing role instructions or sandbox");
                }

                Send(new
                {
                    id = id.Clone(),
                    result = new
                    {
                        thread = new
                        {
                            id = "thread-test"
                        }
                    }
                });
            }
            else if (method == "turn/interrupt")
            {
                Send(new
                {
                    id = id.Clone(),
                    result = new {}
                });
            }
            else if (method == "turn/start")
            {
                if (mode == "input-too-large")
                {
                    Send(new
                    {
                        id = id.Clone(),
                        error = new
                        {
                            code = -32602,
                            message = "PRIVATE_PROVIDER_TEXT",
                            data = new
                            {
                                input_error_code = "input_too_large",
                                max_chars = 1048576,
                                actual_chars = 1300000
                            }
                        }
                    });
                    continue;
                }
                Send(new
                {
                    id = id.Clone(),
                    result = new
                    {
                        turn = new
                        {
                            id = "turn-test"
                        }
                    }
                });
                if (mode == "stall")
                {
                    continue;
                }

                if (mode == "request")
                {
                    Send(new
                    {
                        id = 900,
                        method = "item/commandExecution/requestApproval",
                        @params = new {}
                    });
                    return;
                }

                string input = message.GetProperty("params").GetProperty("input")[0].GetProperty("text").GetString()!;
                if (currentSnapshot == null || !input.Contains(currentSnapshot) || !input.Contains("replace older GameCLI skill snapshots"))
                {
                    throw new Exception("Current skill snapshot was not delivered in the resumed turn");
                }
                if (mode == "design-question" && !input.Contains("schema_version=2"))
                {
                    throw new Exception("Design did not receive the current manifest v2 rules");
                }
                string trace = Regex.Match(input, "trace_id=([^\\n]+)").Groups[1].Value;
                string execution = Regex.Match(input, "execution_id=([^\\n]+)").Groups[1].Value;
                string[] dependencies = mode == "cycle" ? new[]
                {
                    "T1"
                }

                : mode == "missing" ? new[]
                {
                    "T9"
                }

                : Array.Empty<string>();
                PmAnalysis analysis = new(1, null, trace, execution, mode == "blocked" ? "blocked" : "success", new PmData("Test specification", new[]
                {
                    new PmTask("T1", "Task", new[]
                    {
                        "Check"
                    }, dependencies)
                }, new[]
                {
                    "Check"
                }, Array.Empty<string>(), Array.Empty<string>(), true), Array.Empty<string>(), Array.Empty<PmError>());
                string text = mode == "bad-json" ? "not json" : JsonSerializer.Serialize(analysis, PmContract.JsonOptions);
                if (mode == "design-question")
                {
                    text = """
                        {"title":"中文测试","summary":"规则已更新","html":"","questions":["请确认新版规范：控件数量为26。"]}
                        """;
                }
                if (mode == "plan")
                {
                    text = """
                        {"summary":"测试拆分","tasks":[{"id":"ART-1","title":"占位图标","role":"Art","description":"测试产物","source_refs":["4.1"],"depends_on":[],"acceptance":{"preconditions":"测试","steps":"测试","success":"测试","failure":"测试","recovery":"测试","tests":"尚未执行"}}]}
                        """;
                }
                // Deliberately emit notifications immediately after the response to exercise buffering/races.
                Send(new
                {
                    method = "item/agentMessage/delta",
                    @params = new
                    {
                        threadId = "thread-test",
                        turnId = "turn-test",
                        delta = "Working"
                    }
                });
                Send(new
                {
                    method = "item/completed",
                    @params = new
                    {
                        threadId = "thread-test",
                        turnId = "turn-test",
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
                        threadId = "thread-test",
                        turn = new
                        {
                            id = "turn-test",
                            status = mode == "failed-turn" ? "failed" : "completed"
                        }
                    }
                });
            }
        }
    }

    private static void Send(object message)
    {
        Console.WriteLine(JsonSerializer.Serialize(message));
    }
}
