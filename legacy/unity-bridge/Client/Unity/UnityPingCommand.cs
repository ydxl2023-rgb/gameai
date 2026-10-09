using System.Text.Json;

using GameCLI.Abstractions;
using GameCLI.Services;

namespace GameCLI.Plugins.Unity
{
    internal sealed class UnityPingCommand : ICommand
    {
        /// <inheritdoc />
        public string Name => "ping";

        /// <inheritdoc />
        public string Description => "Check the Unity Editor bridge connection.";

        /// <inheritdoc />
        public Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            return RunAsync(args.Length == 1 && args[0] is "--help" or "-h" ? args : new[]
            {
                "--ping"
            }.Concat(args).ToArray(), cancellationToken);
        }

        private const string Usage = "GameCLI unity --ping [--project <Unity project>] [--format human|json]";

        private static async Task<int> RunAsync(string[] args, CancellationToken cancellationToken)
        {
            if (args.Length == 1 && (args[0] == "--help" || args[0] == "-h"))
            {
                Console.WriteLine(Usage);
                return 0;
            }

            string? project = null;
            string format = "human";
            bool ping = false;
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--ping" when !ping:
                        ping = true;
                        break;
                    case "--project" when i + 1 < args.Length && project == null:
                        project = args[++i];
                        break;
                    case "--format" when i + 1 < args.Length:
                        format = args[++i];
                        break;
                    default:
                        Console.Error.WriteLine("Usage: " + Usage);
                        return 4;
                }
            }

            if (!ping || (format != "human" && format != "json"))
            {
                Console.Error.WriteLine("Expected --ping and --format human|json. Usage: " + Usage);
                return 4;
            }

            return await ExecutePingAsync(project, format, cancellationToken);
        }

        private static async Task<int> ExecutePingAsync(string? project, string format, CancellationToken cancellationToken)
        {
            try
            {
                using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                PingResponse response = await UnityBridgeClient.PingAsync(project, timeout.Token);
                if (format == "json")
                {
                    Console.WriteLine(JsonSerializer.Serialize(response, UnityBridgeClient.JsonOptions));
                }
                else
                {
                    Console.WriteLine(response.Message);
                    if (response.Ok)
                    {
                        Console.WriteLine("project: " + response.ProjectPath);
                        Console.WriteLine("unity: " + response.UnityVersion);
                        Console.WriteLine("pid: " + response.Pid);
                    }
                }

                return response.Ok ? 0 : 3;
            }
            catch (Exception exception) when (exception is IOException || exception is OperationCanceledException || exception is JsonException || exception is InvalidOperationException || exception is UnauthorizedAccessException || exception is ArgumentException)
            {
                int exitCode = exception is IOException || exception is OperationCanceledException ? 1 : 5;
                string message = exception is OperationCanceledException ? "Unity bridge timed out after 5 seconds. Open the project and wait for compilation." : exception.Message;
                if (format == "json")
                {
                    Console.WriteLine(JsonSerializer.Serialize(new
                    {
                        ok = false,
                        error = "bridge_unavailable",
                        message
                    }));
                }

                Console.Error.WriteLine(message);
                return exitCode;
            }
        }
    }
}
