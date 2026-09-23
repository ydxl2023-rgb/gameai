using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    /// <summary>Invokes the installed CLI so Editor task creation uses the JIRA plugin gate.</summary>
    internal static class JiraTaskCliClient
    {
        [Serializable]
        internal sealed class Result
        {
            // JsonUtility fields retain the CLI wire names.
            public bool ok;

            public string key;

            public string url;

            public string message;

            public bool outcome_unknown;
        }

        /// <summary>Runs one creation without passing credentials through process arguments.</summary>
        public static async Task<Result> CreateAsync(string unityProject, string summary, string description, CancellationToken cancellation)
        {
            string executable = GameCliInstaller.GetExecutablePath(unityProject);
            if (!File.Exists(executable))
            {
                throw new InvalidOperationException("Install or reinstall GameCLI before creating a task.");
            }

            ProcessStartInfo start = new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = unityProject,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            foreach (string argument in new[]
            {
                "jira",
                "--create",
                "--summary",
                summary,
                "--description",
                description ?? "",
                "--format",
                "json"
            })
            {
                start.ArgumentList.Add(argument);
            }

            cancellation.ThrowIfCancellationRequested();
            using (Process process = new Process
            {
                StartInfo = start
            })
            {
                if (!process.Start())
                {
                    throw new InvalidOperationException("Cannot start GameCLI.");
                }

                Task<string> output = process.StandardOutput.ReadToEndAsync();
                Task<string> errors = process.StandardError.ReadToEndAsync();
                using (CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
                {
                    deadline.CancelAfter(TimeSpan.FromSeconds(75));
                    try
                    {
                        while (!process.HasExited)
                        {
                            await Task.Delay(100, deadline.Token).ConfigureAwait(false);
                        }
                    }
                    catch (OperationCanceledException)
                    {
                        if (!process.HasExited)
                        {
                            process.Kill();
                        }

                        await Task.WhenAll(output, errors).ConfigureAwait(false);
                        return UnknownResult();
                    }
                }

                await Task.WhenAll(output, errors).ConfigureAwait(false);
                Result result;
                try
                {
                    result = JsonUtility.FromJson<Result>(await output.ConfigureAwait(false));
                }
                catch (ArgumentException)
                {
                    return UnknownResult();
                }

                if (result == null || (result.ok && (process.ExitCode != 0 || string.IsNullOrEmpty(result.key) || string.IsNullOrEmpty(result.url))))
                {
                    return UnknownResult();
                }

                if (!result.ok && string.IsNullOrEmpty(result.message))
                {
                    result.message = "Creation failed. Reinstall GameCLI and check the saved JIRA configuration.";
                }

                return result;
            }
        }

        private static Result UnknownResult()
        {
            return new Result
            {
                outcome_unknown = true,
                message = "Creation outcome is unknown. Check JIRA before trying again. If the CLI is outdated, reinstall it."
            };
        }
    }
}
