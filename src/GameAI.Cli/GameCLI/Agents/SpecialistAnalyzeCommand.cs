using System.Text;
using System.Text.Json;
using GameCLI.Abstractions;

namespace GameCLI.Agents
{
    /// <summary>Runs a fixed specialist conversation as a read-only planning step.</summary>
    internal sealed class SpecialistAnalyzeCommand : ICommand
    {
        private readonly string role;

        public SpecialistAnalyzeCommand(string role)
        {
            this.role = role;
        }

        public string Name => "analyze";

        public string Description => "Analyze scope with the fixed role Agent; does not execute production work.";

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            const string usage = "analyze --project <repository> --key <requirement> --prompt-file <UTF-8 file> [--timeout <seconds>]";
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine(usage);
                return 0;
            }
            try
            {
                Dictionary<string, string> values = new();
                for (int i = 0; i < args.Length; i += 2)
                {
                    if (i + 1 >= args.Length || args[i] is not ("--project" or "--key" or "--prompt-file" or "--timeout") || !values.TryAdd(args[i], args[i + 1]))
                    {
                        throw new ArgumentException(usage);
                    }
                }
                using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                int seconds = int.Parse(values.GetValueOrDefault("--timeout", "900"));
                if (seconds < 1 || seconds > 3600)
                {
                    throw new ArgumentException("Timeout must be 1..3600 seconds.");
                }
                timeout.CancelAfter(TimeSpan.FromSeconds(seconds));
                string project = Path.GetFullPath(values["--project"]);
                string prompt = await File.ReadAllTextAsync(values["--prompt-file"], timeout.Token);
                if (string.IsNullOrWhiteSpace(prompt) || Encoding.UTF8.GetByteCount(prompt) > 131072)
                {
                    throw new ArgumentException("Invalid input size.");
                }
                using JsonDocument schema = JsonDocument.Parse("""
                {"type":"object","properties":{"summary":{"type":"string"},"deliverables":{"type":"array","items":{"type":"string"}},"questions":{"type":"array","items":{"type":"string"}}},"required":["summary","deliverables","questions"],"additionalProperties":false}
                """);
                string executionId = Guid.NewGuid().ToString("N");
                AgentRunResult result = await CodexAgentRunner.RunAsync("codex", project, role,
                    "Use the assigned role skills. This is read-only analysis: do not modify files, run commands, create assets, approve, or claim implementation/test completion. Return Chinese scope and verifiable deliverables using the schema.",
                    schema.RootElement.Clone(), prompt, null, Guid.NewGuid().ToString("N"), executionId, text => Console.Error.Write(text), timeout.Token, values["--key"]);
                string directory = Path.Combine(project, "Artifacts", "agent-results");
                Directory.CreateDirectory(directory);
                await File.WriteAllTextAsync(Path.Combine(directory, executionId + ".json"), JsonSerializer.Serialize(result), timeout.Token);
                Console.WriteLine(JsonSerializer.Serialize(result));
                return 0;
            }
            catch (Exception exception) when (exception is ArgumentException or IOException or JsonException or KeyNotFoundException or InvalidOperationException or HttpRequestException or OperationCanceledException or FormatException or System.ComponentModel.Win32Exception)
            {
                Console.Error.WriteLine(exception.Message);
                return 3;
            }
        }
    }
}
