using System;
using System.IO;
using System.IO.Pipes;
using System.Threading;
using System.Threading.Tasks;
using Oathx.GameCLI.Protocol;
using UnityEditor;
using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    [InitializeOnLoad]
    public static class GameCliServer
    {
        private static CancellationTokenSource lifetime;
        private static NamedPipeServerStream activePipe;
        private static readonly object Sync = new object();
        private static string endpointPath;

        static GameCliServer()
        {
            EditorApplication.delayCall += Start;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
        }

        private static void Start()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess() || lifetime != null)
            {
                return;
            }

            string projectPath = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            GameCliCommandSettings.Initialize(projectPath);
            endpointPath = Path.Combine(projectPath, "Library", "GameCLI", "endpoint.json");
            Endpoint endpoint = new Endpoint
            {
                pipeName = "gamecli-" + Guid.NewGuid().ToString("N"),
                token = Guid.NewGuid().ToString("N"),
                projectPath = projectPath,
                unityVersion = Application.unityVersion,
                pid = System.Diagnostics.Process.GetCurrentProcess().Id
            };

            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(endpointPath));
                File.WriteAllText(endpointPath, JsonUtility.ToJson(endpoint, true));
                lifetime = new CancellationTokenSource();
                CancellationToken token = lifetime.Token;
                // Capture all Unity-derived data on the main thread before accepting requests.
                _ = Task.Run(() => ListenAsync(endpoint, token));
            }
            catch (Exception exception)
            {
                Debug.LogError("[GameCLI] Cannot start bridge: " + exception.Message);
                Stop();
            }
        }

        private static async Task ListenAsync(Endpoint endpoint, CancellationToken token)
        {
            try
            {
                while (!token.IsCancellationRequested)
                {
                    using (NamedPipeServerStream pipe = new NamedPipeServerStream(
                        endpoint.pipeName, PipeDirection.InOut, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous))
                    {
                        lock (Sync)
                        {
                            if (token.IsCancellationRequested)
                            {
                                return;
                            }

                            activePipe = pipe;
                        }

                        await pipe.WaitForConnectionAsync(token).ConfigureAwait(false);
                        using (CancellationTokenSource requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(token))
                        {
                            requestTimeout.CancelAfter(TimeSpan.FromSeconds(5));
                            // Disposing unblocks older Unity/Mono pipe reads during timeout or reload.
                            using (requestTimeout.Token.Register(() => pipe.Dispose()))
                            {
                                try
                                {
                                    string json = await PipeProtocol.ReadAsync(pipe, requestTimeout.Token).ConfigureAwait(false);
                                    Request request = JsonUtility.FromJson<Request>(json);
                                    Response response = Handle(request, endpoint);
                                    await PipeProtocol.WriteAsync(pipe, JsonUtility.ToJson(response), requestTimeout.Token).ConfigureAwait(false);
                                }
                                catch (Exception exception) when (
                                    exception is IOException || exception is OperationCanceledException ||
                                    exception is ObjectDisposedException || exception is ArgumentException)
                                {
                                    // One malformed or disconnected client must not stop the listener.
                                }
                            }
                        }

                        lock (Sync)
                        {
                            activePipe = null;
                        }
                    }
                }
            }
            catch (Exception exception)
            {
                if (!token.IsCancellationRequested)
                {
                    Debug.LogError("[GameCLI] Bridge stopped: " + exception.Message);
                }
            }
        }

        private static Response Handle(Request request, Endpoint endpoint)
        {
            if (request == null || request.token != endpoint.token)
            {
                return new Response { error = "unauthorized", message = "Invalid session token." };
            }

            if (request.method != "GET" || request.path != "/ping")
            {
                return new Response { error = "invalid_request", message = "Only GET /ping is supported." };
            }

            if (!GameCliCommandSettings.IsEnabled(request.path))
            {
                return new Response
                {
                    error = "command_disabled",
                    message = "GET /ping is disabled. Enable it in Tools > GameCLI > Window > Unity."
                };
            }

            return new Response
            {
                ok = true,
                message = "pong",
                projectPath = endpoint.projectPath,
                unityVersion = endpoint.unityVersion,
                pid = endpoint.pid,
                respondedAtUtc = DateTime.UtcNow.ToString("O")
            };
        }

        private static void Stop()
        {
            if (lifetime != null)
            {
                lifetime.Cancel();
                lock (Sync)
                {
                    activePipe?.Dispose();
                    activePipe = null;
                }

                // The task owns outstanding token registrations; no main-thread blocking wait.
                lifetime = null;
            }

            try
            {
                if (endpointPath != null && File.Exists(endpointPath))
                {
                    File.Delete(endpointPath);
                }
            }
            catch (IOException exception)
            {
                Debug.LogWarning("[GameCLI] Cannot remove endpoint: " + exception.Message);
            }
        }

        [Serializable]
        private sealed class Endpoint
        {
            public int protocolVersion = 1;
            public string pipeName;
            public string token;
            public string projectPath;
            public string unityVersion;
            public int pid;
        }

        [Serializable]
        private sealed class Request
        {
            public string method;
            public string path;
            public string token;
        }

        [Serializable]
        private sealed class Response
        {
            public bool ok;
            public string message;
            public string error;
            public string projectPath;
            public string unityVersion;
            public int pid;
            public string respondedAtUtc;
        }
    }
}
