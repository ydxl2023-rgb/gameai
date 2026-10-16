using System.Diagnostics;
using System.Text.Json;
using GameCLI.Abstractions;

namespace GameCLI.Plugins.Tasks
{
    /// <summary>Transport only. Validation and scheduling rules belong to GameAI.Server.</summary>
    internal sealed class TaskCommand : ICommand
    {
        public string Name
        { get; }

        public string Description => "validate|" + (Name == "contract" ? "register|generate|prepare|review|check-document" : "submit") + " --input <json> [--contract <json>] [--server <directory>] [--user <human UUID>]";

        public TaskCommand(string name)
        {
            Name = name;
        }

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            if (args.Length == 0 || args[0] is "--help" or "-h")
            {
                Console.WriteLine("GameCLI task " + Name + " " + Description);
                return args.Length == 0 ? 4 : 0;
            }
            try
            {
                string action = args[0];
                if (action != "validate" && action != (Name == "contract" ? "register" : "submit") && !(Name == "contract" && action is "generate" or "prepare" or "review" or "check-document"))
                {
                    throw new ArgumentException("Unknown task action.");
                }
                Dictionary<string, string> options = new(StringComparer.Ordinal);
                for (int i = 1; i < args.Length; i += 2)
                {
                    if (i + 1 >= args.Length || args[i] is not ("--input" or "--contract" or "--server" or "--user") || !options.TryAdd(args[i], args[i + 1]))
                    {
                        throw new ArgumentException(Description);
                    }
                }
                if (!options.TryGetValue("--input", out string? input))
                {
                    throw new ArgumentException("--input is required.");
                }
                if (options.ContainsKey("--contract") && (Name != "plan" || action != "validate"))
                {
                    throw new ArgumentException("--contract is only for offline plan validation.");
                }
                string server = options.GetValueOrDefault("--server") ?? FindServer();
                string script = Path.Combine(Path.GetFullPath(server), "scripts", "task-plan.mjs");
                if (!File.Exists(script))
                {
                    throw new ArgumentException("GameAI.Server adapter not found; specify --server.");
                }
                ValidateFile(input);
                if (options.TryGetValue("--contract", out string? contract))
                {
                    ValidateFile(contract);
                }
                bool online = action is "register" or "submit" || (Name == "plan" && action == "validate" && contract == null);
                if (online && (!options.TryGetValue("--user", out string? user) || !Guid.TryParse(user, out _)))
                {
                    throw new ArgumentException("Database operations require --user <human UUID> on the trusted server host.");
                }
                ProcessStartInfo start = new("node")
                {
                    WorkingDirectory = Path.GetDirectoryName(Path.GetDirectoryName(script))!,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                start.ArgumentList.Add(script);
                start.ArgumentList.Add(Name);
                start.ArgumentList.Add(action);
                foreach (KeyValuePair<string, string> option in options)
                {
                    if (option.Key == "--server")
                    {
                        continue;
                    }
                    start.ArgumentList.Add(option.Key);
                    start.ArgumentList.Add(option.Key is "--input" or "--contract" ? Path.GetFullPath(option.Value) : option.Value);
                }
                using Process process = Process.Start(start) ?? throw new IOException("Cannot start server adapter.");
                using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromMinutes(2));
                try
                {
                    Task stdout = process.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput(), timeout.Token);
                    Task stderr = process.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError(), timeout.Token);
                    await process.WaitForExitAsync(timeout.Token);
                    await Task.WhenAll(stdout, stderr);
                    return process.ExitCode;
                }
                catch (OperationCanceledException)
                {
                    if (!process.HasExited)
                    {
                        process.Kill(true);
                    }
                    // A cancelled submit can have committed: retry with the same requestId.
                    throw new InvalidOperationException("Outcome uncertain; retry the identical requestId to recover the committed result.");
                }
            }
            catch (Exception error) when (error is ArgumentException or IOException or JsonException or InvalidOperationException)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new { success = false, error = error.Message }));
                return error is InvalidOperationException ? 1 : 4;
            }
        }

        private static void ValidateFile(string path)
        {
            FileInfo file = new(path);
            if (!file.Exists || file.Length > 8 * 1024 * 1024)
            {
                throw new ArgumentException("Input must exist and be at most 8 MiB.");
            }
            using JsonDocument document = JsonDocument.Parse(File.ReadAllText(path));
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new ArgumentException("Input must be a JSON object.");
            }
        }

        private static string FindServer()
        {
            for (DirectoryInfo? directory = new(Environment.CurrentDirectory); directory != null; directory = directory.Parent)
            {
                string candidate = Path.Combine(directory.FullName, "game-cli", "src", "GameAI.Server");
                if (File.Exists(Path.Combine(candidate, "scripts", "task-plan.mjs")))
                {
                    return candidate;
                }
                if (File.Exists(Path.Combine(directory.FullName, "scripts", "task-plan.mjs")))
                {
                    return directory.FullName;
                }
            }
            throw new ArgumentException("Run in the repository or specify --server.");
        }
    }
}
