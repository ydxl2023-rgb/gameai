using System.ComponentModel;
using System.Text;
using System.Text.Json;

using GameCLI.Abstractions;
using GameCLI.Agents;
using GameCLI.Contracts;
using GameCLI.Core;
using GameCLI.Services;

namespace GameCLI.Plugins.Orchestrator
{
    internal sealed class WorkflowCommand : ICommand
    {
        public string Name
        { get; }

        public string Description => Name switch
        {
            "start" => "Start a Design agent from a document and wait for requirement approval.",
            "approve" => "Approve the reviewed revision and start a PM agent to create JIRA tasks.",
            "resume" => "Resume a recorded workflow without bypassing approval or repeating unknown writes.",
            "revise" => "Replace the unplanned requirement document and rerun Design.",
            _ => "Read the authoritative workflow, design and created tasks from JIRA."
        };

        public WorkflowCommand(string name)
        {
            Name = name;
        }

        private string Usage => "GameCLI orchestrator --" + Name + (Name == "start" ? " --document <UTF-8 .md|.txt>" : " --issue <KEY-123>") + (Name == "approve" ? " --revision <reviewed SHA-256>" : Name == "revise" ? " --document <UTF-8 .md|.txt>" : "") + (Name == "status" ? "" : " --project <directory> [--skills <game-cli>] [--codex <codex.exe>] [--model <model>] [--timeout <seconds>]") + " [--issue-type <name-or-id>] [--format human|json]";

        /// <inheritdoc />
        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine(Usage);
                return 0;
            }

            bool json = args.Zip(args.Skip(1)).Any(pair => pair.First == "--format" && pair.Second == "json");
            string? issue = null;
            JiraWorkflowStore? store = null;
            using CancellationTokenSource cancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            ConsoleCancelEventHandler cancel = (_, e) =>
            {
                e.Cancel = true;
                cancellation.Cancel();
            };
            Console.CancelKeyPress += cancel;
            if (Console.IsInputRedirected)
            {
                _ = Task.Run(async () =>
                {
                    try
                    {
                        if (await Console.In.ReadLineAsync(cancellation.Token) == "cancel")
                        {
                            cancellation.Cancel();
                        }
                    }
                    catch (Exception exception) when (exception is OperationCanceledException or ObjectDisposedException or IOException)
                    {
                        // Closing the private control pipe does not authorize any workflow action.
                    }
                });
            }

            try
            {
                Dictionary<string, string> options = Parse(args);
                issue = options.GetValueOrDefault("--issue");
                string project = Path.GetFullPath(options.GetValueOrDefault("--project", Environment.CurrentDirectory));
                if (!Directory.Exists(project))
                {
                    throw new DirectoryNotFoundException("Project directory does not exist.");
                }

                string skills = Name == "status" ? "" : FindSkills(project, options.GetValueOrDefault("--skills"));
                int seconds = int.Parse(options.GetValueOrDefault("--timeout", "600"));
                cancellation.CancelAfter(TimeSpan.FromSeconds(seconds));
                string? document = null;
                if (options.TryGetValue("--document", out string? documentPath))
                {
                    if (Path.GetExtension(documentPath).ToLowerInvariant() is not (".md" or ".txt") || new FileInfo(documentPath).Length > 12000)
                    {
                        throw new ArgumentException("The first workflow version accepts UTF-8 .md/.txt documents up to 12000 bytes.");
                    }

                    document = await File.ReadAllTextAsync(documentPath, new UTF8Encoding(false, true), cancellation.Token);
                    if (string.IsNullOrWhiteSpace(document))
                    {
                        throw new ArgumentException("Requirement document is empty.");
                    }
                }

                PluginSettingsStore preferences = new();
                void Guard(string role)
                {
                    Dictionary<string, bool> enabled = preferences.Read();
                    foreach (string id in new[]
                    {
                        "orchestrator",
                        "jira",
                        role
                    })
                    {
                        if (!enabled.GetValueOrDefault(id, true))
                        {
                            throw new JiraTaskException("Plugin is disabled: " + id, 3);
                        }
                    }
                }

                Guard(Name is "start" or "revise" ? "design" : Name == "approve" ? "pm" : "orchestrator");
                JiraConnection connection = await JiraConnection.LoadAsync(cancellation.Token);
                using FileStream? lease = Name == "status" ? null : AcquireLease(connection);
                using HttpClientHandler handler = new()
                {
                    AllowAutoRedirect = false,
                    UseCookies = false
                };
                using HttpClient http = new(handler)
                {
                    Timeout = TimeSpan.FromSeconds(30),
                    MaxResponseContentBufferSize = 1024 * 1024
                };
                store = new JiraWorkflowStore(http, connection, () => Guard("jira"), options.GetValueOrDefault("--issue-type"));
                CodexWorkflowAgent agent = new(options.GetValueOrDefault("--codex", "codex"), project, skills, options.GetValueOrDefault("--model"));
                RequirementWorkflow workflow = new(store, agent, Guard);
                Workflow result = Name switch
                {
                    "start" => await workflow.StartAsync(document!, cancellation.Token),
                    "approve" => await workflow.ApproveAsync(issue!, options["--revision"], cancellation.Token),
                    "resume" => await workflow.ResumeAsync(issue!, cancellation.Token),
                    "revise" => await workflow.ReviseAsync(issue!, document!, cancellation.Token),
                    _ => await store.LoadAsync(issue!, cancellation.Token)
                };
                issue = result.IssueKey;
                bool blocked = Name != "status" && result.Stage == "needs_clarification";
                Console.WriteLine(WorkflowContract.Serialize(new
                {
                    ok = !blocked,
                    issue_key = issue,
                    url = store.IssueUrl(issue),
                    stage = result.Stage,
                    awaiting_approval = result.Stage == "awaiting_approval",
                    workflow = result
                }));
                if (!json && result.Stage == "awaiting_approval")
                {
                    Console.WriteLine("Review the design above, then run: GameCLI orchestrator --approve --issue " + issue + " --revision " + result.Revision + " --project \"" + project + "\"");
                }

                return blocked ? 3 : 0;
            }
            catch (Exception exception) when (exception is JiraTaskException or ArgumentException or IOException or JsonException or InvalidOperationException or OperationCanceledException or HttpRequestException or Win32Exception or UnauthorizedAccessException or CodexInteractionException or KeyNotFoundException)
            {
                issue ??= store?.LastCreatedIssueKey;
                int code = exception switch
                {
                    JiraTaskException error => error.ExitCode,
                    ArgumentException => 4,
                    JsonException => 2,
                    FileNotFoundException or DirectoryNotFoundException or Win32Exception or UnauthorizedAccessException => 5,
                    OperationCanceledException or HttpRequestException or IOException => 1,
                    _ => 3
                };
                string message = exception is OperationCanceledException ? "Workflow cancelled or timed out. Read JIRA before resuming." : exception is Win32Exception or HttpRequestException or UnauthorizedAccessException or KeyNotFoundException ? "Workflow could not access the configured service or executable. Check configuration and permissions." : exception.Message;
                Console.WriteLine(WorkflowContract.Serialize(new
                {
                    ok = false,
                    exit_code = code,
                    issue_key = issue,
                    outcome_unknown = exception is JiraTaskException taskError && taskError.OutcomeUnknown,
                    recovery_label = store?.RecoveryLabel,
                    message
                }));
                Console.Error.WriteLine(message);
                return code;
            }
            finally
            {
                Console.CancelKeyPress -= cancel;
                cancellation.Cancel();
            }
        }

        private Dictionary<string, string> Parse(string[] args)
        {
            HashSet<string> allowed = new()
            {
                "--format",
                "--issue-type"
            };
            if (Name != "status")
            {
                allowed.UnionWith(new[]
                {
                    "--project",
                    "--skills",
                    "--codex",
                    "--model",
                    "--timeout"
                });
            }

            allowed.Add(Name == "start" ? "--document" : "--issue");
            if (Name == "revise")
            {
                allowed.Add("--document");
            }

            if (Name == "approve")
            {
                allowed.Add("--revision");
            }

            Dictionary<string, string> options = new(StringComparer.Ordinal);
            for (int i = 0; i < args.Length; i += 2)
            {
                if (i + 1 >= args.Length || !allowed.Contains(args[i]) || string.IsNullOrWhiteSpace(args[i + 1]) || args[i + 1].StartsWith("--", StringComparison.Ordinal) || !options.TryAdd(args[i], args[i + 1]))
                {
                    throw new ArgumentException(Usage);
                }
            }

            if (Name != "status" && !options.ContainsKey("--project") || Name != "start" && !options.ContainsKey("--issue") || Name is "start" or "revise" && !options.ContainsKey("--document") || Name == "approve" && !options.ContainsKey("--revision") || options.GetValueOrDefault("--format", "human") is not ("human" or "json") || !int.TryParse(options.GetValueOrDefault("--timeout", "600"), out int seconds) || seconds is < 1 or > 3600)
            {
                throw new ArgumentException(Usage);
            }

            return options;
        }

        private static string FindSkills(string project, string? specified)
        {
            IEnumerable<string> candidates = specified != null ? new[]
            {
                Path.GetFullPath(specified)
            }

            : Ancestors(project).SelectMany(directory => new[]
            {
                Path.Combine(directory, "game-cli"),
                Path.Combine(directory, "LocalPackages/com.oathx.gamecli/game-cli"),
                Path.Combine(directory, "app/client/LocalPackages/com.oathx.gamecli/game-cli")
            });
            return candidates.FirstOrDefault(path => new[]
            {
                "gameai-design",
                "gameai-pm",
                "gameai-common",
                "gameai-jira",
                "gameai-jira-issue-writing",
                "gameai-mobile-requirements"
            }.All(name => File.Exists(Path.Combine(path, name, "SKILL.md")))) ?? throw new FileNotFoundException("Missing Design/PM/common skills. Supply --skills <game-cli directory>.");
        }

        private static IEnumerable<string> Ancestors(string project)
        {
            for (DirectoryInfo? directory = new(project); directory != null; directory = directory.Parent)
            {
                yield return directory.FullName;
            }
        }

        private static FileStream AcquireLease(JiraConnection connection)
        {
            // This is a same-user, same-machine execution lock, not persistent workflow state or a distributed lock.
            string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gamecli", "locks");
            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, WorkflowContract.Hash(connection.Address + "\n" + connection.ProjectKey.ToUpperInvariant()) + ".lock");
            try
            {
                return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            }
            catch (IOException)
            {
                throw new JiraTaskException("Another workflow command is running for this JIRA project on this machine.", 3);
            }
        }
    }
}
