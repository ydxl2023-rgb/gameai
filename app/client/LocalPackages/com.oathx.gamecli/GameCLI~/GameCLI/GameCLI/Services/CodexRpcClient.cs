using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace GameCLI.Services
{
    internal sealed class CodexRpcClient : IAsyncDisposable
    {
        private readonly Process process;
        private readonly SemaphoreSlim writer = new SemaphoreSlim(1);
        private readonly CancellationTokenSource lifetime = new();
        private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonElement>> pending = new();
        private readonly Channel<JsonElement> notifications = Channel.CreateUnbounded<JsonElement>();
        private readonly Task reader;
        private readonly Task diagnostics;
        private long nextId;
        private volatile Exception? terminalError;

        public CodexRpcClient(string executable, string project)
        {
            ProcessStartInfo start = new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = project,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardInputEncoding = new UTF8Encoding(false),
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            start.ArgumentList.Add("app-server");
            process = Process.Start(start) ?? throw new InvalidOperationException("Cannot start Codex.");
            // Drain stderr concurrently to prevent pipe deadlocks. Do not forward raw runtime diagnostics or secrets.
            diagnostics = Task.Run(DrainDiagnosticsAsync);
            reader = Task.Run(ReadAsync);
        }

        public async Task<JsonElement> RequestAsync(string method, object parameters, CancellationToken cancellation)
        {
            long id = Interlocked.Increment(ref nextId);
            TaskCompletionSource<JsonElement> completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
            pending[id] = completion;
            try
            {
                if (terminalError != null)
                {
                    throw new IOException("Codex connection has closed.", terminalError);
                }

                await SendAsync(new { id, method, @params = parameters }, cancellation);
                return await completion.Task.WaitAsync(cancellation);
            }
            finally
            {
                pending.TryRemove(id, out _);
            }
        }

        public Task NotifyAsync(string method, object parameters, CancellationToken cancellation)
        {
            return SendAsync(new { method, @params = parameters }, cancellation);
        }

        public IAsyncEnumerable<JsonElement> Notifications(CancellationToken cancellation)
        {
            return notifications.Reader.ReadAllAsync(cancellation);
        }

        private async Task SendAsync(object message, CancellationToken cancellation)
        {
            await writer.WaitAsync(cancellation);
            try
            {
                await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(message).AsMemory(), cancellation);
                await process.StandardInput.FlushAsync(cancellation);
            }
            finally
            {
                writer.Release();
            }
        }

        private async Task DrainDiagnosticsAsync()
        {
            char[] buffer = new char[4096];
            try
            {
                while (await process.StandardError.ReadAsync(buffer.AsMemory(), lifetime.Token) > 0)
                {
                    // Diagnostics can contain provider-specific details; expose only sanitized protocol outcomes.
                }
            }
            catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
            {
                // Shutdown must not wait for inherited pipe handles in a detached tool process.
            }
        }

        private async Task ReadAsync()
        {
            Exception failure = new IOException("Codex exited before the operation completed.");
            try
            {
                while (await process.StandardOutput.ReadLineAsync(lifetime.Token) is string line)
                {
                    using JsonDocument document = JsonDocument.Parse(line);
                    JsonElement message = document.RootElement;
                    if (message.TryGetProperty("id", out JsonElement id))
                    {
                        if (message.TryGetProperty("method", out _))
                        {
                            // This first read-only runner cannot approve actions or answer interactive questions.
                            await SendAsync(new { id = id.Clone(), error = new { code = -32601, message = "Interactive requests are unsupported by GameCLI PM analysis." } }, lifetime.Token);
                            throw new CodexInteractionException("Codex requires an interactive action. Run it interactively or clarify the task.");
                        }

                        if (id.TryGetInt64(out long number) && pending.TryGetValue(number, out TaskCompletionSource<JsonElement>? completion))
                        {
                            if (message.TryGetProperty("error", out JsonElement error))
                            {
                                string code = error.TryGetProperty("code", out JsonElement value) ? value.ToString() : "unknown";
                                completion.TrySetException(new InvalidOperationException("Codex rejected an RPC request (code " + code + "). Check Codex version, login and configuration."));
                            }
                            else
                            {
                                completion.TrySetResult(message.GetProperty("result").Clone());
                            }
                        }
                    }
                    else
                    {
                        await notifications.Writer.WriteAsync(message.Clone());
                    }
                }
            }
            catch (Exception exception)
            {
                failure = exception;
            }
            finally
            {
                terminalError = failure;
                foreach (TaskCompletionSource<JsonElement> completion in pending.Values)
                {
                    completion.TrySetException(failure);
                }

                notifications.Writer.TryComplete(failure);
            }
        }

        public async ValueTask DisposeAsync()
        {
            // This client owns only this server process tree, never an existing desktop Codex process.
            if (!process.HasExited)
            {
                process.StandardInput.Close();
                using CancellationTokenSource grace = new(TimeSpan.FromSeconds(2));
                try
                {
                    await process.WaitForExitAsync(grace.Token);
                }
                catch (OperationCanceledException)
                {
                    if (!process.HasExited)
                    {
                        process.Kill(entireProcessTree: true);
                    }
                }
            }

            await process.WaitForExitAsync();
            lifetime.Cancel();
            await Task.WhenAll(reader, diagnostics);
            process.Dispose();
            writer.Dispose();
            lifetime.Dispose();
        }
    }

    internal sealed class CodexInteractionException : Exception
    {
        public CodexInteractionException(string message) : base(message)
        {
        }
    }
}
