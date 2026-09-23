using System.ComponentModel;
using System.Text;
using System.Text.Json;

using GameCLI.Abstractions;
using GameCLI.Agents;
using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Plugins.PM
{
    internal sealed class PmAnalyzeCommand : ICommand
    {
        /// <inheritdoc />
        public string Name => "analyze";

        /// <inheritdoc />
        public string Description => "Analyze a requirement through Codex as a read-only PM draft.";

        /// <inheritdoc />
        public Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            return RunAsync(args.Length == 1 && args[0] is "--help" or "-h" ? args : new[]
            {
                "--analyze"
            }.Concat(args).ToArray(), cancellationToken);
        }

        private const string Usage = "GameCLI pm --analyze --project <directory> (--prompt <text> | --prompt-file <UTF-8 file>) [--codex <codex.exe>] [--skills <game-cli directory>] [--model <model>] [--timeout <seconds>] [--format human|json]";

        private static async Task<int> RunAsync(string[] args, CancellationToken cancellationToken)
        {
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine(Usage);
                return 0;
            }

            Dictionary<string, string> values = new(StringComparer.Ordinal);
            bool analyze = false;
            bool json = args.Contains("json");
            string traceId = Guid.NewGuid().ToString("N");
            string executionId = Guid.NewGuid().ToString("N");
            using CancellationTokenSource cancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            bool userCancelled = false;
            ConsoleCancelEventHandler handler = (_, e) =>
            {
                e.Cancel = true;
                userCancelled = true;
                cancellation.Cancel();
            };
            try
            {
                for (int i = 0; i < args.Length; i++)
                {
                    string key = args[i];
                    if (key == "--analyze" && !analyze)
                    {
                        analyze = true;
                    }
                    else if (key is "--project" or "--prompt" or "--prompt-file" or "--codex" or "--skills" or "--model" or "--timeout" or "--format" && i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal) && values.TryAdd(key, args[i + 1]))
                    {
                        i++;
                    }
                    else
                    {
                        throw new ArgumentException(Usage);
                    }
                }

                string format = values.GetValueOrDefault("--format", "human");
                json = format == "json";
                if (!analyze || !values.ContainsKey("--project") || format is not ("human" or "json") || values.ContainsKey("--prompt") == values.ContainsKey("--prompt-file") || !int.TryParse(values.GetValueOrDefault("--timeout", "300"), out int seconds) || seconds < 1 || seconds > 3600)
                {
                    throw new ArgumentException(Usage);
                }

                string project = Path.GetFullPath(values["--project"]);
                if (!Directory.Exists(project))
                {
                    throw new DirectoryNotFoundException("Project directory does not exist.");
                }

                string prompt = values.TryGetValue("--prompt", out string? inline) ? inline : await File.ReadAllTextAsync(values["--prompt-file"], new UTF8Encoding(false, true));
                if (string.IsNullOrWhiteSpace(prompt) || Encoding.UTF8.GetByteCount(prompt) > 65536)
                {
                    throw new ArgumentException("Requirement must contain 1 to 65536 UTF-8 bytes.");
                }

                string skills = values.TryGetValue("--skills", out string? skillPath) ? Path.GetFullPath(skillPath) : FindSkills(project);
                foreach (string name in new[]
                {
                    "gameai-pm",
                    "gameai-common",
                    "gameai-jira"
                })
                {
                    if (!File.Exists(Path.Combine(skills, name, "SKILL.md")))
                    {
                        throw new FileNotFoundException("Missing " + name + "/SKILL.md. Use --skills to select the package game-cli directory.");
                    }
                }

                Console.CancelKeyPress += handler;
                cancellation.CancelAfter(TimeSpan.FromSeconds(seconds));
                DateTimeOffset started = DateTimeOffset.UtcNow;
                PmRunResult result = await CodexPmRunner.RunAsync(values.GetValueOrDefault("--codex", "codex"), project, skills, prompt, values.GetValueOrDefault("--model"), traceId, executionId, message => Console.Error.Write(message), cancellation.Token);
                int exitCode = result.Analysis.Status switch
                {
                    "success" => 0,
                    "blocked" => 3,
                    _ => 2
                };
                if (json)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new
                    {
                        ok = exitCode == 0,
                        mode = "read_only_draft",
                        started_at = started,
                        completed_at = DateTimeOffset.UtcNow,
                        result
                    }, PmContract.JsonOptions));
                }
                else
                {
                    Console.WriteLine("PM analysis: " + result.Analysis.Status);
                    Console.WriteLine(JsonSerializer.Serialize(result, PmContract.JsonOptions));
                }

                return exitCode;
            }
            catch (Exception exception) when (exception is ArgumentException or IOException or InvalidOperationException or JsonException or OperationCanceledException or Win32Exception or UnauthorizedAccessException or CodexInteractionException)
            {
                int code = exception switch
                {
                    OperationCanceledException => userCancelled ? 3 : 1,
                    CodexInteractionException => 3,
                    JsonException => 2,
                    ArgumentException => 4,
                    FileNotFoundException or DirectoryNotFoundException or Win32Exception or UnauthorizedAccessException => 5,
                    IOException => 1,
                    _ => 3
                };
                string message = exception is OperationCanceledException ? userCancelled ? "PM analysis cancelled." : "PM analysis timed out." : exception.Message;
                if (json)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new
                    {
                        ok = false,
                        trace_id = traceId,
                        execution_id = executionId,
                        exit_code = code,
                        message
                    }));
                }

                Console.Error.WriteLine(message);
                return code;
            }
            finally
            {
                Console.CancelKeyPress -= handler;
            }
        }

        private static string FindSkills(string project)
        {
            // Support repository, Unity project, package and installed Library/GameCLI entry points.
            for (DirectoryInfo? directory = new(project); directory != null; directory = directory.Parent)
            {
                foreach (string relative in new[]
                {
                    "game-cli",
                    "LocalPackages/com.oathx.gamecli/game-cli",
                    "app/client/LocalPackages/com.oathx.gamecli/game-cli"
                })
                {
                    string candidate = Path.Combine(directory.FullName, relative);
                    if (File.Exists(Path.Combine(candidate, "gameai-pm/SKILL.md")))
                    {
                        return candidate;
                    }
                }
            }

            throw new FileNotFoundException("Cannot locate PM skills. Supply --skills <game-cli directory>.");
        }
    }
}
