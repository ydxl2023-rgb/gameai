using System.Text.Json;
using System.Text.Json.Nodes;
using GameCLI.Abstractions;
using GameCLI.Services.UiLibrary;

namespace GameCLI.Plugins.UiLibrary
{
    internal sealed class ChangeGuardCommand : ICommand
    {
        public string Name => "guard";

        public string Description => "--baseline <snapshot> --candidate <snapshot> --output <new file> [--approval <reviewed changes>]; without approval writes an audit only";

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            try
            {
                Dictionary<string, string> options = new(StringComparer.Ordinal);
                for (int index = 0; index < args.Length; index += 2)
                {
                    if (index + 1 >= args.Length || !new[] { "--baseline", "--candidate", "--output", "--approval" }.Contains(args[index])
                        || !options.TryAdd(args[index], args[index + 1]))
                    {
                        throw new InvalidDataException(Description);
                    }
                }
                foreach (string key in new[] { "--baseline", "--candidate", "--output" })
                {
                    if (!options.ContainsKey(key))
                    {
                        throw new InvalidDataException(Description);
                    }
                }
                foreach (string key in options.Keys.Where(key => key != "--output"))
                {
                    if (new FileInfo(options[key]).Length > 4 * 1024 * 1024)
                    {
                        throw new InvalidDataException("Input exceeds 4 MiB.");
                    }
                }
                string baseline = await File.ReadAllTextAsync(options["--baseline"], cancellationToken);
                string candidate = await File.ReadAllTextAsync(options["--candidate"], cancellationToken);
                JsonObject result;
                if (options.TryGetValue("--approval", out string? approvalPath))
                {
                    JsonObject approval = JsonNode.Parse(await File.ReadAllTextAsync(approvalPath, cancellationToken))!.AsObject();
                    result = UiChangeGuard.Compile(baseline, candidate, approval);
                }
                else
                {
                    result = new JsonObject
                    {
                        ["schemaVersion"] = "ui-change-audit/1",
                        ["sourceSha256"] = AssemblyPlanCompiler.Hash(baseline),
                        ["candidateSha256"] = AssemblyPlanCompiler.Hash(candidate),
                        ["authorizationStatus"] = "not_verified",
                        ["changes"] = UiChangeGuard.Diff(UiChangeGuard.Normalize(JsonNode.Parse(baseline)!.AsObject()), UiChangeGuard.Normalize(JsonNode.Parse(candidate)!.AsObject()))
                    };
                }
                using FileStream stream = new(options["--output"], FileMode.CreateNew, FileAccess.Write);
                await JsonSerializer.SerializeAsync(stream, result, new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
                Console.WriteLine(JsonSerializer.Serialize(new { success = true, output = options["--output"], executable = options.ContainsKey("--approval") }));
                return 0;
            }
            catch (Exception error) when (error is InvalidDataException or IOException or JsonException or InvalidOperationException or ArgumentException)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { success = false, code = "change_guard_rejected", message = error.Message }));
                return 4;
            }
        }
    }
}
