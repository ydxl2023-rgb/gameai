using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using GameCLI.Abstractions;
using GameCLI.Agents;

namespace GameCLI.Plugins.Design
{
    internal sealed class DesignDocumentCommand : ICommand
    {
        private readonly bool submitOnly;

        public DesignDocumentCommand(bool submitOnly = false)
        {
            this.submitOnly = submitOnly;
        }

        public string Name => submitOnly ? "submit" : "draft";

        public string Description => submitOnly ? "Retry a saved Design submission without rerunning the Agent." : "Run Design through Codex, save HTML, and submit it for human review.";

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            const string usage = "GameCLI design draft --project <repository> --prompt-file <file> --key <KEY> --version <version> [--server <url>] [--codex <exe>] [--skills <directory>] [--model <id>] [--timeout <seconds>] | design submit --submission <saved.json> --server <url>. Submission uses GAMEAI_SUBMISSION_TOKEN.";
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine(usage);
                return 0;
            }
            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            ConsoleCancelEventHandler cancel = (_, e) =>
            {
                e.Cancel = true;
                timeout.Cancel();
            };
            Console.CancelKeyPress += cancel;
            try
            {
                Dictionary<string, string> values = new(StringComparer.Ordinal);
                for (int i = 0; i < args.Length; i += 2)
                {
                    if (i + 1 >= args.Length || args[i] is not ("--project" or "--prompt-file" or "--key" or "--version" or "--server" or "--codex" or "--skills" or "--model" or "--timeout" or "--submission") || !values.TryAdd(args[i], args[i + 1]))
                    {
                        throw new ArgumentException(usage);
                    }
                }
                int seconds = int.Parse(values.GetValueOrDefault("--timeout", "900"));
                if (seconds < 1 || seconds > 3600)
                {
                    throw new ArgumentException("Timeout must be 1..3600 seconds.");
                }
                timeout.CancelAfter(TimeSpan.FromSeconds(seconds));
                string submissionPath;
                if (submitOnly)
                {
                    submissionPath = Path.GetFullPath(values["--submission"]);
                }
                else
                {
                    string project = Path.GetFullPath(values["--project"]);
                    if (!Directory.Exists(Path.Combine(project, "app")))
                    {
                        throw new ArgumentException("--project must point to the repository root containing app.");
                    }
                    string prompt = await File.ReadAllTextAsync(values["--prompt-file"], Encoding.UTF8, timeout.Token);
                    if (string.IsNullOrWhiteSpace(prompt) || Encoding.UTF8.GetByteCount(prompt) > 131072)
                    {
                        throw new ArgumentException("Requirement input must be 1..131072 UTF-8 bytes.");
                    }
                    string skillRoot = values.GetValueOrDefault("--skills", Path.Combine(project, "app/client/LocalPackages/com.oathx.gamecli/game-cli"));
                    StringBuilder instructions = new();
                    foreach (string skill in new[] { "gameai-design", "gameai-document-format", "gameai-requirement-discovery", "gameai-mobile-requirements", "gameai-task-writing", "gameai-common", "gameai-cli-development" })
                    {
                        instructions.AppendLine(await File.ReadAllTextAsync(Path.Combine(skillRoot, skill, "SKILL.md"), timeout.Token));
                    }
                    instructions.AppendLine(await File.ReadAllTextAsync(Path.Combine(skillRoot, "gameai-document-format/assets/outline-template.html"), timeout.Token));
                    instructions.AppendLine(await File.ReadAllTextAsync(Path.Combine(skillRoot, "gameai-document-format/assets/phone-landscape-frame.svg"), timeout.Token));
                    instructions.AppendLine("Produce the complete Chinese standalone HTML in the html field. This host saves the actual file. Do not write files, approve, upload, dispatch, or invoke tools. Use provided verified research and user choices; do not invent browsing. Return questions for material unresolved choices; no submission occurs until questions is empty. Document status must be 待人工审批. No external assets or executable scripts. Render all wireframes inline. The requested version is " + values["--version"] + ".");
                    using JsonDocument schema = JsonDocument.Parse("""
                    {"type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"html":{"type":"string"},"questions":{"type":"array","items":{"type":"string"}}},"required":["title","summary","html","questions"],"additionalProperties":false}
                    """);
                    string executionId = Guid.NewGuid().ToString("N");
                    AgentRunResult run = await CodexAgentRunner.RunAsync(values.GetValueOrDefault("--codex", "codex"), project, "Design", instructions.ToString(), schema.RootElement.Clone(), prompt, values.GetValueOrDefault("--model"), Guid.NewGuid().ToString("N"), executionId, text => Console.Error.Write(text), timeout.Token);
                    using JsonDocument result = JsonDocument.Parse(run.Text);
                    JsonElement output = result.RootElement;
                    if (output.GetProperty("questions").GetArrayLength() != 0)
                    {
                        Console.WriteLine(run.Text);
                        return 3;
                    }
                    string html = output.GetProperty("html").GetString() ?? "";
                    byte[] bytes = Encoding.UTF8.GetBytes(html);
                    if (!html.Contains("<html", StringComparison.OrdinalIgnoreCase) || !html.Contains("</html>", StringComparison.OrdinalIgnoreCase) || bytes.Length > 5 * 1024 * 1024 || bytes.Length < 100)
                    {
                        throw new JsonException("Design did not return a complete HTML document.");
                    }
                    string directory = Path.Combine(project, "app/desgin");
                    Directory.CreateDirectory(directory);
                    string htmlPath = Path.Combine(directory, "策划需求-" + executionId + ".html");
                    await File.WriteAllBytesAsync(htmlPath, bytes, timeout.Token);
                    submissionPath = Path.ChangeExtension(htmlPath, ".submission.json");
                    var payload = new
                    {
                        request_id = Guid.NewGuid().ToString(),
                        requirement_key = values["--key"],
                        version = values["--version"],
                        title = output.GetProperty("title").GetString(),
                        summary = output.GetProperty("summary").GetString(),
                        html,
                        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                        execution_id = executionId,
                        thread_id = run.ThreadId
                    };
                    await File.WriteAllTextAsync(submissionPath, JsonSerializer.Serialize(payload), Encoding.UTF8, timeout.Token);
                    Console.Error.WriteLine("Saved HTML: " + htmlPath + "\nSubmission: " + submissionPath);
                }
                if (!values.TryGetValue("--server", out string? server))
                {
                    if (submitOnly)
                    {
                        throw new ArgumentException("--server is required for submit.");
                    }
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "draft_saved", submission = submissionPath }));
                    return 0;
                }
                string receipt = await SubmitAsync(server, submissionPath, timeout.Token);
                await File.WriteAllTextAsync(submissionPath + ".receipt.json", receipt, timeout.Token);
                Console.WriteLine(receipt);
                return 0;
            }
            catch (Exception exception) when (exception is ArgumentException or KeyNotFoundException or IOException or InvalidOperationException or JsonException or HttpRequestException or OperationCanceledException or FormatException or System.ComponentModel.Win32Exception)
            {
                Console.Error.WriteLine(exception is OperationCanceledException ? "Design cancelled or timed out; no approval was performed." : exception.Message);
                return 3;
            }
            finally
            {
                Console.CancelKeyPress -= cancel;
            }
        }

        private static async Task<string> SubmitAsync(string server, string file, CancellationToken cancellation)
        {
            Uri endpoint = new(server.TrimEnd('/') + "/api/track/requirements");
            if (endpoint.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(endpoint.UserInfo) || !string.IsNullOrEmpty(endpoint.Query) || !string.IsNullOrEmpty(endpoint.Fragment))
            {
                throw new ArgumentException("Invalid server URL.");
            }
            string token = Environment.GetEnvironmentVariable("GAMEAI_SUBMISSION_TOKEN") ?? throw new InvalidOperationException("GAMEAI_SUBMISSION_TOKEN is missing.");
            using HttpClient http = new() { Timeout = TimeSpan.FromSeconds(30) };
            http.DefaultRequestHeaders.Authorization = new("Bearer", token);
            string payload = await File.ReadAllTextAsync(file, Encoding.UTF8, cancellation);
            // Every retry preserves the exact persisted request ID and document bytes.
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    using StringContent content = new(payload, Encoding.UTF8, "application/json");
                    using HttpResponseMessage response = await http.PostAsync(endpoint, content, cancellation);
                    string body = await response.Content.ReadAsStringAsync(cancellation);
                    if (response.IsSuccessStatusCode)
                    {
                        return body;
                    }
                    if ((int)response.StatusCode < 500)
                    {
                        throw new InvalidOperationException("Submission rejected: " + body);
                    }
                    if (attempt == 3)
                    {
                        throw new IOException("Submission failed after three attempts. Retry the saved submission file.");
                    }
                }
                catch (Exception exception) when ((exception is HttpRequestException || exception is TaskCanceledException && !cancellation.IsCancellationRequested) && attempt < 3)
                {
                    Console.Error.WriteLine("Upload response unavailable; retrying the same request.");
                }
                await Task.Delay(TimeSpan.FromSeconds(attempt), cancellation);
            }
            throw new IOException("Submission failed. Retry the saved submission file.");
        }
    }
}
