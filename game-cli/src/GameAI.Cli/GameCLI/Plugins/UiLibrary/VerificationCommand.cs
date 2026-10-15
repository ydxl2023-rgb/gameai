using System.Text.Json;
using System.Text.Json.Nodes;
using GameCLI.Abstractions;
using GameCLI.Services.UiLibrary;

namespace GameCLI.Plugins.UiLibrary
{
    internal sealed class VerificationCommand : ICommand
    {
        public string Name
        { get; }

        public string Description => "build-contract: --source --inventory [--rules]; verify-delivery: --contract --evidence --project; both require --output <new file>";

        public VerificationCommand(string name)
        {
            Name = name;
        }

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            try
            {
                Dictionary<string, string> options = new(StringComparer.Ordinal);
                for (int i = 0; i < args.Length; i += 2)
                {
                    if (i + 1 >= args.Length || !options.TryAdd(args[i], args[i + 1]))
                    {
                        throw new InvalidDataException(Description);
                    }
                }
                string Read(string key) => File.ReadAllText(options[key]);
                JsonObject result;
                if (Name == "build-contract")
                {
                    result = VerificationContract.Build(Read("--source"), Read("--inventory"),
                        options.ContainsKey("--rules") ? JsonNode.Parse(Read("--rules"))!.AsArray() : null,
                        options.ContainsKey("--manifest") ? Read("--manifest") : null);
                }
                else
                {
                    JsonObject evidence = JsonNode.Parse(Read("--evidence"))!.AsObject();
                    if (evidence["evidenceJson"] is JsonValue payload)
                    {
                        evidence = JsonNode.Parse(payload.GetValue<string>())!.AsObject();
                    }
                    result = VerificationContract.Verify(Read("--contract"), (evidence["data"] ?? evidence).AsObject(), options["--project"]);
                }
                using FileStream output = new(options["--output"], FileMode.CreateNew, FileAccess.Write);
                await JsonSerializer.SerializeAsync(output, result, new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
                Console.WriteLine(result.ToJsonString());
                return result["passed"]?.GetValue<bool>() == false ? 4 : 0;
            }
            catch (Exception error) when (error is InvalidDataException or IOException or JsonException or InvalidOperationException or ArgumentException or KeyNotFoundException)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { passed = false, message = error.Message }));
                return 4;
            }
        }
    }
}
