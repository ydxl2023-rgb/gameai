using System.Text.Json;
using System.Text.RegularExpressions;
using GameCLI.Abstractions;
using GameCLI.Core;
using GameCLI.Plugins.PM;
using GameCLI.Services;
using GameCLI.Contracts;

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
        foreach ((string mode, int expected) in new[]
        {
            ("success", 0), ("cycle", 2), ("missing", 2), ("bad-json", 2), ("blocked", 3),
            ("failed-turn", 3), ("request", 3), ("eof", 1), ("stall", 1)
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
                PluginHost host = new(new ICLIPlugin[] { new PMPlugin() }, new PluginSettingsStore(Path.Combine(Path.GetTempPath(), "gamecli-smoke-" + Guid.NewGuid().ToString("N"), "plugins.json")));
                code = await host.RunAsync(new[] { "pm", "--analyze", "--project", root, "--prompt", "A test requirement",
                    "--codex", Environment.ProcessPath ?? throw new Exception("No executable"), "--timeout", "2", "--format", "json" });
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
        }

        Environment.SetEnvironmentVariable("GAMECLI_FAKE_MODE", null);
        Console.WriteLine("CODEX_PROTOCOL_SMOKE_PASSED");
        return 0;
    }

    private static async Task FakeServerAsync()
    {
        string? mode = Environment.GetEnvironmentVariable("GAMECLI_FAKE_MODE");
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
                Send(new { id = id.Clone(), result = new { } });
            }
            else if (method == "thread/start")
            {
                JsonElement p = message.GetProperty("params");
                if (p.GetProperty("sandbox").GetString() != "read-only" ||
                    !p.GetProperty("developerInstructions").GetString()!.Contains("# PM Agent"))
                {
                    throw new Exception("Missing role instructions or sandbox");
                }

                Send(new { id = id.Clone(), result = new { thread = new { id = "thread-test" } } });
            }
            else if (method == "turn/interrupt")
            {
                Send(new { id = id.Clone(), result = new { } });
            }
            else if (method == "turn/start")
            {
                Send(new { id = id.Clone(), result = new { turn = new { id = "turn-test" } } });
                if (mode == "stall")
                {
                    continue;
                }

                if (mode == "request")
                {
                    Send(new { id = 900, method = "item/commandExecution/requestApproval", @params = new { } });
                    return;
                }

                string input = message.GetProperty("params").GetProperty("input")[0].GetProperty("text").GetString()!;
                string trace = Regex.Match(input, "trace_id=([^\\n]+)").Groups[1].Value;
                string execution = Regex.Match(input, "execution_id=([^\\n]+)").Groups[1].Value;
                string[] dependencies = mode == "cycle" ? new[] { "T1" } : mode == "missing" ? new[] { "T9" } : Array.Empty<string>();
                PmAnalysis analysis = new(1, null, trace, execution, mode == "blocked" ? "blocked" : "success",
                    new PmData("Test specification", new[] { new PmTask("T1", "Task", new[] { "Check" }, dependencies) },
                        new[] { "Check" }, Array.Empty<string>(), Array.Empty<string>(), true), Array.Empty<string>(), Array.Empty<PmError>());
                string text = mode == "bad-json" ? "not json" : JsonSerializer.Serialize(analysis, PmContract.JsonOptions);
                // Deliberately emit notifications immediately after the response to exercise buffering/races.
                Send(new { method = "item/agentMessage/delta", @params = new { threadId = "thread-test", turnId = "turn-test", delta = "Working" } });
                Send(new { method = "item/completed", @params = new { threadId = "thread-test", turnId = "turn-test", item = new { type = "agentMessage", phase = "final_answer", text } } });
                Send(new { method = "turn/completed", @params = new { threadId = "thread-test", turn = new { id = "turn-test", status = mode == "failed-turn" ? "failed" : "completed" } } });
            }
        }
    }

    private static void Send(object message)
    {
        Console.WriteLine(JsonSerializer.Serialize(message));
    }
}
