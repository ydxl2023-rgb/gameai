using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Oathx.GameCLI.Editor
{
    /// <summary>
    /// Builds and runs the bundled CLI in the current Unity project's Library directory.
    /// </summary>
    public static class GameCliInstaller
    {
        /// <summary>Resolves the project-local executable path without checking installation state.</summary>
        public static string GetExecutablePath(string unityProject)
        {
            return Path.Combine(Path.GetFullPath(unityProject), "Library", "GameCLI", "GameCLI.exe");
        }

        /// <summary>Builds the bundled CLI with a five-minute deadline and forwards process output.</summary>
        /// <returns>The build process exit code; zero also requires the executable to exist.</returns>
        /// <exception cref="OperationCanceledException">The caller cancels the operation.</exception>
        /// <exception cref="TimeoutException">The build exceeds its deadline.</exception>
        public static async Task<int> InstallAsync(string sourceProject, string unityProject, IProgress<string> log, CancellationToken cancellation)
        {
            if (!File.Exists(sourceProject))
            {
                throw new FileNotFoundException("The bundled GameCLI.csproj was not found.", sourceProject);
            }

            string output = Path.GetDirectoryName(GetExecutablePath(unityProject));
            Directory.CreateDirectory(output);
            ProcessStartInfo start = CreateStartInfo("dotnet", unityProject);
            AddArguments(start, "build", Path.GetFullPath(sourceProject), "-c", "Release", "--nologo", "--disable-build-servers", "-p:UseSharedCompilation=false", "-o", output);
            int exitCode = await RunAsync(start, log, TimeSpan.FromMinutes(5), cancellation).ConfigureAwait(false);
            if (exitCode == 0 && !File.Exists(GetExecutablePath(unityProject)))
            {
                throw new IOException("Build completed but GameCLI.exe was not produced.");
            }

            return exitCode;
        }

        /// <summary>Runs the installed Unity ping command with a fifteen-second process deadline.</summary>
        /// <returns>The CLI process exit code.</returns>
        /// <exception cref="FileNotFoundException">The project-local CLI is not installed.</exception>
        public static Task<int> PingAsync(string unityProject, IProgress<string> log, CancellationToken cancellation)
        {
            string executable = GetExecutablePath(unityProject);
            if (!File.Exists(executable))
            {
                throw new FileNotFoundException("Install GameCLI before running Ping.", executable);
            }

            ProcessStartInfo start = CreateStartInfo(executable, unityProject);
            AddArguments(start, "unity", "--ping", "--project", Path.GetFullPath(unityProject), "--format", "json");
            return RunAsync(start, log, TimeSpan.FromSeconds(15), cancellation);
        }

        private static ProcessStartInfo CreateStartInfo(string executable, string workingDirectory)
        {
            return new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = Path.GetFullPath(workingDirectory),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
        }

        private static void AddArguments(ProcessStartInfo start, params string[] arguments)
        {
            foreach (string argument in arguments)
            {
                start.ArgumentList.Add(argument);
            }
        }

        private static async Task<int> RunAsync(ProcessStartInfo start, IProgress<string> log, TimeSpan timeout, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            using (CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
            {
                using (Process process = new Process
                {
                    StartInfo = start
                })
                {
                    deadline.CancelAfter(timeout);
                    if (!process.Start())
                    {
                        throw new InvalidOperationException("Could not start " + start.FileName);
                    }

                    // Drain both pipes concurrently so a full stderr buffer cannot deadlock a build.
                    Task stdout = ForwardAsync(process.StandardOutput, log);
                    Task stderr = ForwardAsync(process.StandardError, log);
                    try
                    {
                        while (!process.HasExited)
                        {
                            await Task.Delay(100, deadline.Token).ConfigureAwait(false);
                        }

                        await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
                        return process.ExitCode;
                    }
                    catch (OperationCanceledException)
                    {
                        if (!process.HasExited)
                        {
                            process.Kill();
                        }

                        await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
                        if (!cancellation.IsCancellationRequested)
                        {
                            throw new TimeoutException("The CLI operation exceeded its time limit.");
                        }

                        throw;
                    }
                }
            }
        }

        private static async Task ForwardAsync(StreamReader reader, IProgress<string> log)
        {
            string line;
            while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
            {
                log?.Report(line);
            }
        }
    }
}
