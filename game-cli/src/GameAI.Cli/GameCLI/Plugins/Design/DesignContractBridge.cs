using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace GameCLI.Plugins.Design
{
    internal static class DesignContractBridge
    {
        internal static async Task<JsonDocument> ExecuteAsync(string project, string action, object input, CancellationToken cancellation)
        {
            string script = Path.Combine(project, "game-cli/src/GameAI.Server/scripts/task-plan.mjs");
            if (!File.Exists(script))
            {
                throw new IOException("Production contract compiler not found in the platform repository.");
            }
            string directory = GameCLI.Services.ProductionPaths.DirectoryFor("design-contracts");
            Directory.CreateDirectory(directory);
            string file = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".json");
            await File.WriteAllTextAsync(file, JsonSerializer.Serialize(input), Encoding.UTF8, cancellation);
            ProcessStartInfo start = new("node")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = Path.GetDirectoryName(script)!
            };
            start.ArgumentList.Add(script);
            start.ArgumentList.Add("contract");
            start.ArgumentList.Add(action);
            start.ArgumentList.Add("--input");
            start.ArgumentList.Add(file);
            using Process process = Process.Start(start) ?? throw new IOException("Cannot start contract compiler.");
            Task<string> stdout = process.StandardOutput.ReadToEndAsync(cancellation);
            Task<string> stderr = process.StandardError.ReadToEndAsync(cancellation);
            try
            {
                await process.WaitForExitAsync(cancellation);
            }
            catch (OperationCanceledException)
            {
                if (!process.HasExited)
                {
                    process.Kill(true);
                }
                throw;
            }
            string output = await stdout;
            string error = await stderr;
            if (process.ExitCode != 0)
            {
                throw new InvalidOperationException("Contract rejected: " + error);
            }
            return JsonDocument.Parse(output);
        }
    }
}
