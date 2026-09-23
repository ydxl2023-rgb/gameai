using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

using GameCLI.Contracts;

namespace GameCLI.Services
{
    /// <summary>Maintains an authenticated project event subscription with bounded replay and reconnect backoff.</summary>
    internal sealed class ServerEventClient
    {
        private readonly Uri address;

        private readonly string token;

        private readonly string projectKey;

        private readonly string clientId;

        private readonly Action guard;

        public ServerEventClient(Uri address, string token, string projectKey, string clientId, Action guard)
        {
            this.address = address;
            this.token = token;
            this.projectKey = projectKey;
            this.clientId = clientId;
            this.guard = guard;
        }

        /// <summary>Reports subscription and issue events. Cursors advance only after the consumer accepts an event.</summary>
        /// <remarks>Reconnect cursors are volatile transport metadata. Notifications never launch agents or mutate JIRA.</remarks>
        public async Task<int> RunAsync(Func<ServerEnvelope, CancellationToken, Task> consume, int maximumEvents, CancellationToken cancellation)
        {
            ServerCursor? cursor = null;
            int received = 0;
            int retries = 0;
            while (true)
            {
                cancellation.ThrowIfCancellationRequested();
                guard();
                using ClientWebSocket socket = new();
                socket.Options.SetRequestHeader("Authorization", "Bearer " + token);
                socket.Options.CollectHttpResponseDetails = true;
                using CancellationTokenSource lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                Task heartbeat = Task.CompletedTask;
                try
                {
                    using (CancellationTokenSource connect = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
                    {
                        connect.CancelAfter(TimeSpan.FromSeconds(10));
                        await socket.ConnectAsync(address, connect.Token);
                    }

                    ServerEnvelope welcome = await ReceiveAsync(socket, 10000, lifetime.Token);
                    if (welcome.Type != "server.welcome" || !Guid.TryParse(welcome.Payload.GetProperty("server_id").GetString(), out _))
                    {
                        throw new InvalidDataException("服务器握手消息无效。");
                    }

                    int interval = welcome.Payload.GetProperty("heartbeat_interval_ms").GetInt32();
                    if (interval is < 50 or > 60000)
                    {
                        throw new InvalidDataException("服务器心跳配置无效。");
                    }

                    await SendAsync(socket, ServerEnvelope.Create("worker.register", new
                    {
                        client_id = clientId,
                        project_key = projectKey,
                        cursor
                    }), lifetime.Token);
                    ServerEnvelope registered = await ReceiveAsync(socket, 10000, lifetime.Token);
                    RequireRegistered(registered, welcome, cursor);
                    cursor = new ServerCursor(registered.Payload.GetProperty("server_id").GetString()!, registered.Payload.GetProperty("resume_sequence").GetInt64());
                    await consume(registered, cancellation);
                    retries = 0;
                    heartbeat = HeartbeatAsync(socket, interval, lifetime);
                    while (true)
                    {
                        ServerEnvelope envelope = await ReceiveAsync(socket, Math.Max(1000, interval * 3), lifetime.Token);
                        guard();
                        if (envelope.Type == "server.heartbeat")
                        {
                            continue;
                        }

                        if (envelope.Type != "jira.issue_changed")
                        {
                            throw new InvalidDataException("收到当前协议不支持的服务器消息。");
                        }

                        JsonElement payload = envelope.Payload;
                        long sequence = payload.GetProperty("sequence").GetInt64();
                        if (payload.GetProperty("project_key").GetString() != projectKey || payload.GetProperty("server_id").GetString() != cursor.ServerId)
                        {
                            throw new InvalidDataException("消息不属于当前项目或服务会话。");
                        }

                        if (sequence <= cursor.Sequence)
                        {
                            continue;
                        }

                        if (sequence != cursor.Sequence + 1)
                        {
                            throw new InvalidDataException("实时事件序号不连续，需要重新核对 JIRA。");
                        }

                        await consume(envelope, cancellation);
                        cursor = cursor with
                        {
                            Sequence = sequence
                        };
                        received++;
                        if (maximumEvents > 0 && received >= maximumEvents)
                        {
                            return received;
                        }
                    }
                }
                catch (WebSocketException) when (!cancellation.IsCancellationRequested)
                {
                    if (socket.HttpStatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                    {
                        throw new InvalidOperationException("服务鉴权失败，请检查 GAMECLI_SERVER_TOKEN。");
                    }
                }
                catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
                {
                    // Connect/receive deadlines trigger reconnect, never a workflow state transition.
                }
                finally
                {
                    lifetime.Cancel();
                    socket.Abort();
                    try
                    {
                        await heartbeat;
                    }
                    catch (OperationCanceledException)
                    {
                        // The heartbeat belongs to this connection and ends before reconnecting.
                    }
                }

                int delay = Math.Min(30000, 1000 * (1 << Math.Min(retries++, 5))) + Random.Shared.Next(0, 250);
                await consume(ServerEnvelope.Create("client.reconnecting", new
                {
                    delay_ms = delay,
                    message = "连接中断，等待重连。"
                }), cancellation);
                await Task.Delay(delay, cancellation);
            }
        }

        private void RequireRegistered(ServerEnvelope registered, ServerEnvelope welcome, ServerCursor? previous)
        {
            if (registered.Type != "worker.registered")
            {
                throw new InvalidDataException("服务拒绝注册，请检查项目和客户端编号。");
            }

            JsonElement payload = registered.Payload;
            long sequence = payload.GetProperty("resume_sequence").GetInt64();
            string? serverId = payload.GetProperty("server_id").GetString();
            bool resync = payload.GetProperty("resync_required").GetBoolean();
            if (payload.GetProperty("project_key").GetString() != projectKey || payload.GetProperty("client_id").GetString() != clientId || serverId != welcome.Payload.GetProperty("server_id").GetString() || sequence < 0 || !resync && (previous == null || previous.ServerId != serverId || previous.Sequence != sequence))
            {
                throw new InvalidDataException("服务返回了不匹配的订阅或恢复游标。");
            }
        }

        private static async Task HeartbeatAsync(ClientWebSocket socket, int interval, CancellationTokenSource lifetime)
        {
            using PeriodicTimer timer = new(TimeSpan.FromMilliseconds(interval));
            try
            {
                while (await timer.WaitForNextTickAsync(lifetime.Token))
                {
                    await SendAsync(socket, ServerEnvelope.Create("worker.heartbeat", new {}), lifetime.Token);
                }
            }
            catch (WebSocketException)
            {
                lifetime.Cancel();
            }
        }

        private static Task SendAsync(ClientWebSocket socket, ServerEnvelope envelope, CancellationToken cancellation)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(WorkflowContract.Serialize(envelope));
            return socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellation);
        }

        private static async Task<ServerEnvelope> ReceiveAsync(ClientWebSocket socket, int timeoutMilliseconds, CancellationToken cancellation)
        {
            using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(timeoutMilliseconds);
            using MemoryStream message = new();
            byte[] buffer = new byte[8192];
            while (true)
            {
                WebSocketReceiveResult result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), deadline.Token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    throw new WebSocketException("服务器关闭连接。");
                }

                if (result.MessageType != WebSocketMessageType.Text || message.Length + result.Count > 65536)
                {
                    throw new InvalidDataException("服务器消息类型或长度无效。");
                }

                message.Write(buffer, 0, result.Count);
                if (result.EndOfMessage)
                {
                    ServerEnvelope envelope = WorkflowContract.Parse<ServerEnvelope>(new UTF8Encoding(false, true).GetString(message.ToArray()));
                    envelope.Validate();
                    return envelope;
                }
            }
        }
    }
}
