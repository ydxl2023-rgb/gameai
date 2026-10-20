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
            const string usage = "GameCLI design draft --project <repository> --project-id <UUID> --prompt-file <file> --key <KEY> --version <version> [--window-spec <JSON array>] [--source-document <HTML>] [--draft-file <saved draft JSON>] [--server <url>] [--codex <exe>] [--skills <directory>] [--model <id>] [--timeout <seconds>] | design submit --submission <saved.json> --server <url>. Submission uses GAMEAI_SUBMISSION_TOKEN.";
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
                    if (i + 1 >= args.Length || args[i] is not ("--draft-file" or "--window-spec" or "--source-document" or "--review-prompt-file" or "--project-id" or "--project" or "--prompt-file" or "--key" or "--version" or "--server" or "--codex" or "--skills" or "--model" or "--timeout" or "--submission") || !values.TryAdd(args[i], args[i + 1]))
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
                string submissionPath = "";
                if (submitOnly)
                {
                    submissionPath = Path.GetFullPath(values["--submission"]);
                }
                else
                {
                    string project = Path.GetFullPath(values["--project"]);
                    if (!Directory.Exists(project))
                    {
                        throw new ArgumentException("--project must point to an existing target repository.");
                    }
                    if (!values.TryGetValue("--project-id", out string? projectId) || !Guid.TryParse(projectId, out _))
                    {
                        throw new ArgumentException("--project-id must identify the target Track project.");
                    }
                    string requirementVersionId = Guid.NewGuid().ToString();
                    string contractId = Guid.NewGuid().ToString();
                    string prompt = await File.ReadAllTextAsync(values["--prompt-file"], Encoding.UTF8, timeout.Token);
                    if (string.IsNullOrWhiteSpace(prompt) || Encoding.UTF8.GetByteCount(prompt) > 6 * 1024 * 1024)
                    {
                        throw new ArgumentException("Requirement input must be 1..6291456 UTF-8 bytes.");
                    }
                    string skillRoot = values.GetValueOrDefault("--skills", GameCLI.Services.SkillPaths.Resolve());
                    StringBuilder instructions = new();
                    foreach (string skill in new[] { "design/ShigeruMiyamoto", "common/gameai-document-format", "common/gameai-ui-delivery-contract", "common/gameai-mobile-requirements", "common/gameai-task-writing", "common" })
                    {
                        instructions.AppendLine(await File.ReadAllTextAsync(Path.Combine(skillRoot, skill, "SKILL.md"), timeout.Token));
                    }
                    instructions.AppendLine(await File.ReadAllTextAsync(Path.Combine(skillRoot, "common/gameai-document-format/assets/outline-template.html"), timeout.Token));
                    instructions.AppendLine(await File.ReadAllTextAsync(Path.Combine(skillRoot, "common/gameai-document-format/assets/phone-landscape-frame.svg"), timeout.Token));
                    instructions.AppendLine("For UI template reuse, consume the host-provided pinned template version, full structure and dependency/binding evidence, and approved changes. Search summaries, IDs or inaccessible paths alone are insufficient. Do not query or replace the template. Return UI_TEMPLATE_CONTEXT_MISSING in questions if required source context is absent. Keep template provenance, complete target hierarchy and animation/effect requirements inside each window section; do not add unsupported manifest fields. New UI without a selected template must be explicitly identified as new construction.");
                    instructions.AppendLine("Produce the complete Chinese standalone HTML in the html field. This host saves the actual file. Do not write files, approve, upload, dispatch, or invoke tools. Use provided verified research and user choices; do not invent browsing. Return questions for material unresolved choices; no submission occurs until questions is empty. Document status must be 待人工审批. No external assets or executable scripts. Render all wireframes inline. The requested version is " + values["--version"] + ".");
                    instructions.AppendLine("Return windowsJson as a JSON array of complete production-contract windows matching the supplied schema. Include sourceAnchor pointing to each full visible section. Use pinned template facts and explicit authorized changes; do not invent missing data. Do not embed ui-production-contract, ui-delivery-manifest or design-contract-review in HTML; the host compiler owns these. Component, animation and effect specifications must remain complete. Return unresolved gaps in questions.");
                    instructions.AppendLine(await File.ReadAllTextAsync(Path.Combine(project, "game-cli/src/GameAI.Server/schemas/ui-tasks/production-contract.schema.json"), timeout.Token));
                    // The reviewed document already carries complete compiled attachments.
                    // A separate source brief avoids repeating those attachments in the review input.
                    string reviewRequirements = values.TryGetValue("--review-prompt-file", out string? reviewPromptPath)
                        ? await File.ReadAllTextAsync(reviewPromptPath, Encoding.UTF8, timeout.Token)
                        : prompt;
                    string? frozenWindows = values.TryGetValue("--window-spec", out string? windowsPath) ? await File.ReadAllTextAsync(windowsPath, timeout.Token) : null;
                    if (frozenWindows is not null)
                    {
                        instructions.AppendLine("The host has deterministically compiled complete window specifications. Return windowsJson as [] without copying them. Author only the visible HTML and review the supplied frozen candidate; report contradictions in questions. Do not embed machine blocks. The host inserts the exact verified candidate after your response.");
                        prompt += "\nHost compiled window specifications:\n" + frozenWindows;
                    }
                    using JsonDocument schema = JsonDocument.Parse("""
                    {"type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"html":{"type":"string"},"windowsJson":{"type":"string"},"questions":{"type":"array","items":{"type":"string"}}},"required":["title","summary","html","windowsJson","questions"],"additionalProperties":false}
                    """);
                    for (int revisionAttempt = 0; revisionAttempt < 3; revisionAttempt++)
                    {
                        string executionId = Guid.NewGuid().ToString("N");
                        string draftText;
                        if (revisionAttempt == 0 && values.TryGetValue("--draft-file", out string? draftFile))
                        {
                            // A resumed draft still requires compilation and a fresh fixed Design review.
                            draftText = await File.ReadAllTextAsync(draftFile, timeout.Token);
                        }
                        else
                        {
                            AgentRunResult draftRun = await CodexAgentRunner.RunAsync(values.GetValueOrDefault("--codex", "codex"), project, "Design", instructions.ToString(), schema.RootElement.Clone(), prompt, values.GetValueOrDefault("--model"), Guid.NewGuid().ToString("N"), executionId, text => Console.Error.Write(text), timeout.Token, values["--key"]);
                            draftText = draftRun.Text;
                        }
                        using JsonDocument result = JsonDocument.Parse(draftText);
                        JsonElement output = result.RootElement;
                        if (output.GetProperty("questions").GetArrayLength() != 0)
                        {
                            Console.WriteLine(draftText);
                            return 3;
                        }
                        string html = output.GetProperty("html").GetString() ?? "";
                        using JsonDocument windows = JsonDocument.Parse(frozenWindows ?? output.GetProperty("windowsJson").GetString() ?? "[]");
                        using JsonDocument prepared = await DesignContractBridge.ExecuteAsync(project, "prepare", new
                        {
                            html,
                            sourceHtml = values.TryGetValue("--source-document", out string? sourceDocument) ? await File.ReadAllTextAsync(sourceDocument, timeout.Token) : null,
                            spec = new { schemaVersion = "ui-design-spec/1", id = contractId, version = 1, projectId, requirementVersionId, windows = windows.RootElement }
                        }, timeout.Token);
                        html = prepared.RootElement.GetProperty("html").GetString()!;
                        string contractHash = prepared.RootElement.GetProperty("contractHash").GetString()!;
                        string documentHash = prepared.RootElement.GetProperty("documentHash").GetString()!;
                        using JsonDocument reviewSchema = JsonDocument.Parse("""
                        {"type":"object","properties":{"passed":{"type":"boolean"},"issues":{"type":"array","items":{"type":"string"}},"summary":{"type":"string"}},"required":["passed","issues","summary"],"additionalProperties":false}
                        """);
                        string reviewExecutionId = Guid.NewGuid().ToString("N");
                        AgentRunResult reviewed = await CodexAgentRunner.RunAsync(values.GetValueOrDefault("--codex", "codex"), project, "Design",
                            "Review the compiled document against the original requirement. Check scope, every node/control, dimensions, resource slots, animation/effect bindings and style. Do not approve for the human or invoke tools. Return passed=false with concrete issues if any facts are missing or contradictory.",
                            reviewSchema.RootElement.Clone(), "Original requirement:\n" + reviewRequirements + "\nCompiled document (lossless packed attachment):\n" + prepared.RootElement.GetProperty("reviewHtml").GetString(),
                            values.GetValueOrDefault("--model"), Guid.NewGuid().ToString("N"), reviewExecutionId, text => Console.Error.Write(text), timeout.Token, values["--key"]);
                        using JsonDocument review = JsonDocument.Parse(reviewed.Text);
                        if (!review.RootElement.GetProperty("passed").GetBoolean() || review.RootElement.GetProperty("issues").GetArrayLength() != 0)
                        {
                            string failedPath = Path.Combine(GameCLI.Services.ProductionPaths.DirectoryFor("design-contracts"), reviewExecutionId + ".review.json");
                            await File.WriteAllTextAsync(failedPath, JsonSerializer.Serialize(new { html, review = review.RootElement }), timeout.Token);
                            if (revisionAttempt == 2)
                            {
                                throw new InvalidOperationException("Design self-review failed after bounded revisions: " + failedPath);
                            }
                            prompt += "\nRevise your draft using these self-review findings; preserve the agreed scope.\n" + reviewed.Text;
                            continue;
                        }
                        using JsonDocument sealedDocument = await DesignContractBridge.ExecuteAsync(project, "review", new
                        {
                            html,
                            review = new { passed = true, issues = Array.Empty<string>(), summary = review.RootElement.GetProperty("summary").GetString(), documentHash, contractHash, executionId = reviewExecutionId, threadId = reviewed.ThreadId }
                        }, timeout.Token);
                        html = sealedDocument.RootElement.GetProperty("html").GetString()!;
                        // Submission proof belongs to the completed review execution, not the earlier draft run.
                        executionId = reviewExecutionId;
                        AgentRunResult run = reviewed;
                        byte[] bytes = Encoding.UTF8.GetBytes(html);
                        if (!html.Contains("<html", StringComparison.OrdinalIgnoreCase) || !html.Contains("</html>", StringComparison.OrdinalIgnoreCase) || bytes.Length > 5 * 1024 * 1024 || bytes.Length < 100)
                        {
                            throw new JsonException("Design did not return a complete HTML document.");
                        }
                        string directory = Path.Combine(project, "app/desgin");
                        Directory.CreateDirectory(directory);
                        string htmlPath = Path.Combine(directory, "策划需求-" + executionId + ".html");
                        await File.WriteAllBytesAsync(htmlPath, bytes, timeout.Token);
                        submissionPath = Path.Combine(GameCLI.Services.ProductionPaths.DirectoryFor("design"), executionId + ".submission.json");
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
                        break;
                        }
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
