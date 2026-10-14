using System.Text.Json;
using System.Text.Json.Nodes;
using GameCLI.Abstractions;
using GameCLI.Services.UiLibrary;

namespace GameCLI.Plugins.UiLibrary
{
    internal sealed class ManifestCheckCommand : ICommand
    {
        public string Name => "check-manifest";
        public string Description => "--input <ui-template snapshot> --project <Unity project> --output <new report.json>; read-only PNG manifest validation";

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            try
            {
                Dictionary<string, string> options = new(StringComparer.Ordinal);
                for (int index = 0; index < args.Length; index += 2)
                {
                    if (index + 1 >= args.Length || !new[] { "--input", "--project", "--output" }.Contains(args[index]) || !options.TryAdd(args[index], args[index + 1]))
                    {
                        throw new InvalidDataException(Description);
                    }
                }
                if (options.Count != 3 || new FileInfo(options["--input"]).Length > 8 * 1024 * 1024)
                {
                    throw new InvalidDataException(Description);
                }
                JsonObject document = JsonNode.Parse(await File.ReadAllTextAsync(options["--input"], cancellationToken))!.AsObject();
                JsonObject report = UiManifestValidator.Validate(document, options["--project"]);
                using FileStream output = new(options["--output"], FileMode.CreateNew, FileAccess.Write);
                await JsonSerializer.SerializeAsync(output, report, new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
                Console.WriteLine(report.ToJsonString());
                return (bool)report["passed"]! ? 0 : 4;
            }
            catch (Exception error) when (error is InvalidDataException or IOException or JsonException or InvalidOperationException or ArgumentException or UnauthorizedAccessException)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { passed = false, error = error.Message }));
                return 4;
            }
        }
    }
}
