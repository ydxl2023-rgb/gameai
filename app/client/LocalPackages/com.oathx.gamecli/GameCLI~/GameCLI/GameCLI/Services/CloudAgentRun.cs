using System.Net.Http.Json;
using System.Text.Json;

namespace GameCLI.Services
{
    /// <summary>Owns one server-authorized fixed Agent run and renews its lease while Codex works.</summary>
    internal sealed class CloudAgentRun : IAsyncDisposable
    {
        private readonly HttpClient http;
        private readonly string workerKey;
        private readonly string executionId;
        private readonly CancellationTokenSource heartbeatStop = new();
        private readonly CancellationTokenSource lifetime;
        private Task heartbeat = Task.CompletedTask;
        private bool completed;

        public string AgentKey
        { get; }

        public string? ThreadId
        { get; }

        public string Instructions
        { get; }

        public bool WorkspaceWrite
        { get; }

        public CancellationToken Token => lifetime.Token;

        private CloudAgentRun(HttpClient http, string workerKey, string executionId, JsonElement claim, CancellationToken cancellation)
        {
            this.http = http;
            this.workerKey = workerKey;
            this.executionId = executionId;
            AgentKey = claim.GetProperty("agent_key").GetString()!;
            ThreadId = claim.GetProperty("thread_id").GetString();
            Instructions = claim.GetProperty("instructions").GetString()!;
            WorkspaceWrite = claim.TryGetProperty("workspace_write", out JsonElement write) && write.GetBoolean();
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        }

        public static async Task<CloudAgentRun> OpenAsync(string project, string role, string key, string executionId, string inputHash, CancellationToken cancellation)
        {
            string file = Path.Combine(project, ".gamecli", "client.json");
            using JsonDocument config = JsonDocument.Parse(await File.ReadAllTextAsync(file, cancellation));
            JsonElement settings = config.RootElement;
            Uri server = new(settings.GetProperty("server").GetString()!.TrimEnd('/') + "/");
            if (server.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(server.UserInfo) || !string.IsNullOrEmpty(server.Query) || !string.IsNullOrEmpty(server.Fragment))
            {
                throw new InvalidOperationException("Invalid GameCLI server URL.");
            }
            HttpClient http = new()
            {
                BaseAddress = server,
                Timeout = TimeSpan.FromSeconds(15)
            };
            http.DefaultRequestHeaders.Authorization = new("Bearer", settings.GetProperty("token").GetString());
            string worker = settings.GetProperty("worker_key").GetString()!;
            try
            {
                using HttpResponseMessage response = await http.PostAsJsonAsync("api/track/agent-runs", new
                {
                    action = "claim",
                    execution_id = executionId,
                    role,
                    requirement_key = key,
                    worker_key = worker,
                    input_hash = inputHash
                }, cancellation);
                JsonElement claim = await ReadAsync(response, cancellation);
                CloudAgentRun run = new(http, worker, executionId, claim, cancellation);
                run.heartbeat = run.HeartbeatAsync();
                return run;
            }
            catch
            {
                http.Dispose();
                throw;
            }
        }

        public async Task AttachAsync(string threadId)
        {
            await SendAsync(new
            {
                action = "attach",
                execution_id = executionId,
                worker_key = workerKey,
                thread_id = threadId
            }, Token);
        }

        public async Task CompleteAsync()
        {
            heartbeatStop.Cancel();
            await heartbeat;
            await SendAsync(new
            {
                action = "finish",
                execution_id = executionId,
                worker_key = workerKey,
                state = "completed"
            }, Token);
            completed = true;
        }

        private async Task HeartbeatAsync()
        {
            try
            {
                using PeriodicTimer timer = new(TimeSpan.FromSeconds(20));
                while (await timer.WaitForNextTickAsync(heartbeatStop.Token))
                {
                    await SendAsync(new
                    {
                        action = "heartbeat",
                        execution_id = executionId,
                        worker_key = workerKey
                    }, heartbeatStop.Token);
                }
            }
            catch (OperationCanceledException) when (heartbeatStop.IsCancellationRequested)
            {
                // The owning run stopped renewal after completion or cancellation.
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine("Fixed Agent heartbeat lost: " + exception.GetType().Name);
                lifetime.Cancel();
            }
        }

        private async Task SendAsync(object payload, CancellationToken cancellation)
        {
            using HttpResponseMessage response = await http.PostAsJsonAsync("api/track/agent-runs", payload, cancellation);
            await ReadAsync(response, cancellation);
        }

        private static async Task<JsonElement> ReadAsync(HttpResponseMessage response, CancellationToken cancellation)
        {
            using JsonDocument body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException(body.RootElement.TryGetProperty("error", out JsonElement error) ? error.GetString() : "Fixed Agent request failed.");
            }
            return body.RootElement.Clone();
        }

        public async ValueTask DisposeAsync()
        {
            heartbeatStop.Cancel();
            await heartbeat;
            if (!completed)
            {
                using CancellationTokenSource cleanup = new(TimeSpan.FromSeconds(10));
                try
                {
                    await SendAsync(new
                    {
                        action = "finish",
                        execution_id = executionId,
                        worker_key = workerKey,
                        state = "failed",
                        error = "CLI execution did not complete; inspect local diagnostics."
                    }, cleanup.Token);
                }
                catch (Exception exception)
                {
                    Console.Error.WriteLine("Run release not acknowledged: " + exception.GetType().Name);
                }
            }
            lifetime.Dispose();
            heartbeatStop.Dispose();
            http.Dispose();
        }
    }
}
