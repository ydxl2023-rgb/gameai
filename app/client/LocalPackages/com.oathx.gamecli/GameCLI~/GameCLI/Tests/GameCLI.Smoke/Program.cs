using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;

using Oathx.GameCLI.Protocol;

namespace GameCLI.Smoke
{
    internal static class Program
    {
        private static async Task Main(string[] args)
        {
            if (args.Length != 2)
            {
                throw new ArgumentException("Expected Unity project path and built GameCLI.dll path.");
            }

            string project = Path.GetFullPath(args[0]);
            string cli = Path.GetFullPath(args[1]);
            using JsonDocument endpoint = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(project, "Library", "GameCLI", "endpoint.json")));
            string pipeName = endpoint.RootElement.GetProperty("pipeName").GetString()!;
            string sessionToken = endpoint.RootElement.GetProperty("token").GetString()!;
            using CancellationTokenSource timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            await RunCliAsync(cli, project, 0, "unity", "--ping", "--format", "json");
            await RunCliAsync(cli, project, 4, "unity", "--ping", "--format", "invalid");
            await RunCliAsync(cli, project, 4, "ping");
            await RunCliAsync(cli, project, 4, "jira");
            await RunCliAsync(cli, project, 4, "unity");
            await RunCliAsync(cli, project, 4, "unity", "--ping", "--ping");
            await CheckRequestAsync(pipeName, "invalid-token", "/ping", "unauthorized", timeout.Token);
            await CheckRequestAsync(pipeName, sessionToken, "/unknown", "invalid_request", timeout.Token);
            // A peer closing partway through a header must not take down the server.
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous))
            {
                await pipe.ConnectAsync(timeout.Token);
                await pipe.WriteAsync(new byte[]
                {
                    4,
                    0
                }, timeout.Token);
            }

            await RunCliAsync(cli, project, 0, "unity", "--ping", "--format", "json");
            Console.WriteLine("PASS: live pong, input exit code, auth, route and partial-frame recovery.");
        }

        private static async Task CheckRequestAsync(string pipeName, string token, string route, string expectedError, CancellationToken cancellation)
        {
            using NamedPipeClientStream pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            await pipe.ConnectAsync(cancellation);
            await PipeProtocol.WriteAsync(pipe, JsonSerializer.Serialize(new
            {
                method = "GET",
                path = route,
                token
            }), cancellation);
            using JsonDocument response = JsonDocument.Parse(await PipeProtocol.ReadAsync(pipe, cancellation));
            if (response.RootElement.GetProperty("ok").GetBoolean() || response.RootElement.GetProperty("error").GetString() != expectedError || response.RootElement.TryGetProperty("token", out _))
            {
                throw new InvalidOperationException("Unexpected bridge response.");
            }
        }

        private static async Task RunCliAsync(string cli, string project, int expectedExit, params string[] command)
        {
            ProcessStartInfo start = new ProcessStartInfo("dotnet")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            start.ArgumentList.Add(cli);
            foreach (string argument in command)
            {
                start.ArgumentList.Add(argument);
            }

            start.ArgumentList.Add("--project");
            start.ArgumentList.Add(project);
            using Process process = Process.Start(start) ?? throw new InvalidOperationException("CLI did not start.");
            Task<string> outputTask = process.StandardOutput.ReadToEndAsync();
            Task<string> errorTask = process.StandardError.ReadToEndAsync();
            using CancellationTokenSource timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                process.Kill(true);
                throw;
            }

            string output = await outputTask;
            string error = await errorTask;
            if (process.ExitCode != expectedExit)
            {
                throw new InvalidOperationException("Unexpected CLI exit: " + process.ExitCode + " " + error);
            }

            if (expectedExit == 0)
            {
                using JsonDocument response = JsonDocument.Parse(output);
                if (!response.RootElement.GetProperty("ok").GetBoolean() || response.RootElement.GetProperty("message").GetString() != "pong" || !string.IsNullOrEmpty(error))
                {
                    throw new InvalidOperationException("Expected a real pong with clean stdout/stderr.");
                }
            }
        }
    }
}
