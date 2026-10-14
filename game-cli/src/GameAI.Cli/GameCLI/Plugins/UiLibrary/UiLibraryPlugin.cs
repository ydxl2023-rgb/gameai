using System.Diagnostics;
using GameCLI.Abstractions;

namespace GameCLI.Plugins.UiLibrary
{
    /// <summary>Exposes the local server-owned template maintenance adapter.</summary>
    public sealed class UiLibraryPlugin : CLIPlugin
    {
        public override string Id => "ui-library";

        public override string Description => "Validate and import Unity layout export packages";

        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new OfflineExportCommand(),
            new AssembleCommand(),
            new ChangeGuardCommand(),
            new ManifestCheckCommand(),
            new RestoreCommand(),
            new LibraryCommand("search"),
            new LibraryCommand("validate"),
            new LibraryCommand("import")
        });
    }

    internal sealed class LibraryCommand : ICommand
    {
        public string Name
        { get; }

        public string Description => Name == "search" ? "--query <description> --server <GameAI.Server> [--output <report-directory>]" : "--input <export-directory> --server <GameAI.Server> [--dry-run]";

        public LibraryCommand(string name)
        {
            Name = name;
        }

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            string? input = null;
            string? server = null;
            string? outputDirectory = null;
            bool dryRun = false;
            for (int index = 0; index < args.Length; index++)
            {
                switch (args[index])
                {
                    case "--query" when Name == "search" && index + 1 < args.Length:
                        input = args[++index];
                        break;
                    case "--output" when Name == "search" && index + 1 < args.Length:
                        outputDirectory = Path.GetFullPath(args[++index]);
                        break;
                    case "--input" when index + 1 < args.Length:
                        input = Path.GetFullPath(args[++index]);
                        break;
                    case "--server" when index + 1 < args.Length:
                        server = Path.GetFullPath(args[++index]);
                        break;
                    case "--dry-run":
                        dryRun = true;
                        break;
                    default:
                        throw new ArgumentException("Unknown or incomplete option: " + args[index]);
                }
            }
            if (input == null || server == null)
            {
                throw new ArgumentException(Description);
            }
            string adapter = Path.Combine(server, "scripts", "ui-library.mjs");
            if (!File.Exists(adapter))
            {
                throw new ArgumentException("GameAI.Server maintenance adapter not found.");
            }
            ProcessStartInfo start = new("node")
            {
                WorkingDirectory = server,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            start.ArgumentList.Add(adapter);
            start.ArgumentList.Add(Name);
            start.ArgumentList.Add(input);
            if (outputDirectory != null)
            {
                start.ArgumentList.Add(outputDirectory);
            }
            if (dryRun)
            {
                start.ArgumentList.Add("--dry-run");
            }
            // The child inherits structured stdout and credentials from the local service environment.
            using Process process = Process.Start(start) ?? throw new InvalidOperationException("Cannot start maintenance adapter.");
            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(5));
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
