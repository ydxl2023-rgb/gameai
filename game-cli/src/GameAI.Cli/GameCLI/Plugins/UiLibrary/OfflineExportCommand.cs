using System.Text.Json;
using GameCLI.Abstractions;
using GameCLI.Services.UiLibrary;

namespace GameCLI.Plugins.UiLibrary
{
    internal sealed class OfflineExportCommand : ICommand
    {
        public string Name => "export";

        public string Description => "Offline: --input <prefab or directory> --output <empty directory> --source-key <project ID> [--limit N]";

        public Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            Dictionary<string, string> options = new(StringComparer.Ordinal);
            for (int index = 0; index < args.Length; index += 2)
            {
                if (index + 1 >= args.Length || !new[] { "--input", "--output", "--source-key", "--limit", "--offset" }.Contains(args[index]) || !options.TryAdd(args[index], args[index + 1]))
                {
                    throw new ArgumentException(Description);
                }
            }
            if (!options.ContainsKey("--input") || !options.ContainsKey("--output") || !options.ContainsKey("--source-key"))
            {
                throw new ArgumentException(Description);
            }
            int limit = options.TryGetValue("--limit", out string? value) ? int.Parse(value) : int.MaxValue;
            if (limit < 1 || string.IsNullOrWhiteSpace(options["--source-key"]))
            {
                throw new ArgumentException("Positive limit and nonempty source key required.");
            }
            OfflinePrefabExporter exporter = new(options["--input"], options["--output"], options["--source-key"], cancellationToken);
            System.Text.Json.Nodes.JsonObject report = exporter.Run(limit, options.TryGetValue("--offset", out string? offset) ? Math.Max(0, int.Parse(offset)) : 0);
            Console.WriteLine(JsonSerializer.Serialize(report));
            return Task.FromResult(report["success"]!.GetValue<bool>() ? 0 : 2);
        }
    }
}
