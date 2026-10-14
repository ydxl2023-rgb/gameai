using System.Text.Json;
using System.Text.Json.Nodes;
using GameCLI.Abstractions;
using GameCLI.Services.UiLibrary;

namespace GameCLI.Plugins.UiLibrary
{
    internal sealed class AssembleCommand : ICommand
    {
        public string Name => "assemble";

        public string Description => "--snapshot <json> --plan <json> --output <new assembly.json>; compiles layout edits, does not run Unity";

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            try
            {
                return await CompileAsync(args, cancellationToken);
            }
            catch (Exception error) when (error is InvalidDataException or JsonException or InvalidOperationException or ArgumentException)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { success = false, code = "assembly_contract_invalid", message = error.Message }));
                return 4;
            }
            catch (IOException error)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { success = false, code = "assembly_io_error", message = error.Message }));
                return 2;
            }
        }

        private async Task<int> CompileAsync(string[] args, CancellationToken cancellationToken)
        {
            Dictionary<string, string> options = new(StringComparer.Ordinal);
            for (int index = 0; index < args.Length; index += 2)
            {
                if (index + 1 >= args.Length || !new[] { "--snapshot", "--plan", "--output" }.Contains(args[index])
                    || !options.TryAdd(args[index], args[index + 1]))
                {
                    throw new ArgumentException(Description);
                }
            }
            if (options.Count != 3)
            {
                throw new ArgumentException(Description);
            }
            foreach (string key in new[] { "--snapshot", "--plan" })
            {
                if (new FileInfo(options[key]).Length > 4 * 1024 * 1024)
                {
                    throw new InvalidDataException("Assembly input exceeds 4 MiB.");
                }
            }
            string source = await File.ReadAllTextAsync(options["--snapshot"], cancellationToken);
            JsonObject plan = JsonNode.Parse(await File.ReadAllTextAsync(options["--plan"], cancellationToken))!.AsObject();
            JsonObject result = AssemblyPlanCompiler.Compile(source, plan);
            string output = Path.GetFullPath(options["--output"]);
            // CreateNew prevents an interrupted or repeated command from overwriting approved inputs.
            using FileStream stream = new(output, FileMode.CreateNew, FileAccess.Write);
            await JsonSerializer.SerializeAsync(stream, result, cancellationToken: cancellationToken);
            Console.WriteLine(JsonSerializer.Serialize(new { success = true, action = "assembly-compile", output, unityValidated = false }));
            return 0;
        }
    }
}
