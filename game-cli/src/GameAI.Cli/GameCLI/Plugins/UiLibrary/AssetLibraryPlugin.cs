using System.Diagnostics;
using GameCLI.Abstractions;

namespace GameCLI.Plugins.UiLibrary
{
    /// <summary>Explicit adapter for the isolated production asset database.</summary>
    public sealed class AssetLibraryPlugin : CLIPlugin
    {
        public override string Id => "asset-library";

        public override string Description => "Dedicated PostgreSQL asset library and local embedding index";

        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new AssetLibraryCommand("migrate"),
            new AssetLibraryCommand("upload"),
            new AssetLibraryCommand("index-init"),
            new AssetLibraryCommand("index"),
            new AssetLibraryCommand("search"),
            new AssetLibraryCommand("report")
        });
    }

    internal sealed class AssetLibraryCommand : ICommand
    {
        public string Name
        { get; }

        public string Description => "--server <GameAI.Server directory> followed by action arguments; credentials in .env.asset-library";

        public AssetLibraryCommand(string name)
        {
            Name = name;
        }

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            if (args.Length < 2 || args[0] != "--server")
            {
                throw new ArgumentException(Description);
            }
            string server = Path.GetFullPath(args[1]);
            string script = Path.Combine(server, "scripts", "asset-library.mjs");
            if (!File.Exists(script))
            {
                throw new ArgumentException("Asset library server adapter not found.");
            }
            ProcessStartInfo start = new("node")
            {
                WorkingDirectory = server,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            start.ArgumentList.Add(script);
            start.ArgumentList.Add(Name);
            foreach (string argument in args.Skip(2))
            {
                start.ArgumentList.Add(argument);
            }
            using Process process = Process.Start(start) ?? throw new InvalidOperationException("Cannot start asset adapter.");
            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(20));
            try
            {
                Task output = process.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput(), timeout.Token);
                Task errors = process.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError(), timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                await Task.WhenAll(output, errors);
                return process.ExitCode;
            }
            catch (OperationCanceledException)
            {
                if (!process.HasExited)
                {
                    process.Kill(true);
                }
                throw;
            }
        }
    }
}
