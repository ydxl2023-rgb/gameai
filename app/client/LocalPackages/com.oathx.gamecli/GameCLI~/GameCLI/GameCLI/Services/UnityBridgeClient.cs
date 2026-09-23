using System.IO.Pipes;
using System.Text.Json;

using Oathx.GameCLI.Protocol;

namespace GameCLI.Services
{
    internal static class UnityBridgeClient
    {
        internal static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true
        };

        /// <summary>Contacts the selected Unity project's endpoint and validates the responding Editor identity.</summary>
        /// <remarks>The caller supplies the deadline through cancellation; this method owns the pipe connection.</remarks>
        public static async Task<PingResponse> PingAsync(string? projectPath, CancellationToken token)
        {
            string root = FindProject(projectPath);
            string path = Path.Combine(root, "Library", "GameCLI", "endpoint.json");
            if (!File.Exists(path))
            {
                throw new InvalidOperationException("GameCLI endpoint not found. Open this Unity project and wait for the Game CLI package to compile.");
            }

            Endpoint? endpoint = JsonSerializer.Deserialize<Endpoint>(await File.ReadAllTextAsync(path, token), JsonOptions);
            if (endpoint == null || endpoint.ProtocolVersion != 1 || string.IsNullOrWhiteSpace(endpoint.PipeName) || !endpoint.PipeName.StartsWith("gamecli-", StringComparison.Ordinal) || string.IsNullOrWhiteSpace(endpoint.Token) || endpoint.Pid <= 0 || string.IsNullOrWhiteSpace(endpoint.ProjectPath) || !IsSamePath(endpoint.ProjectPath, root))
            {
                throw new InvalidOperationException("GameCLI endpoint is invalid or belongs to a different project.");
            }

            using NamedPipeClientStream pipe = new NamedPipeClientStream(".", endpoint.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            await pipe.ConnectAsync(token);
            string request = JsonSerializer.Serialize(new
            {
                method = "GET",
                path = "/ping",
                token = endpoint.Token
            });
            await PipeProtocol.WriteAsync(pipe, request, token);
            string json = await PipeProtocol.ReadAsync(pipe, token);
            PingResponse? response = JsonSerializer.Deserialize<PingResponse>(json, JsonOptions);
            if (response == null || (response.Ok && (response.Message != "pong" || string.IsNullOrWhiteSpace(response.ProjectPath) || !IsSamePath(response.ProjectPath, root) || response.Pid != endpoint.Pid || string.IsNullOrWhiteSpace(response.UnityVersion) || !DateTimeOffset.TryParse(response.RespondedAtUtc, out _))))
            {
                throw new InvalidOperationException("Invalid ping response from the Unity bridge.");
            }

            return response;
        }

        private static bool IsSamePath(string left, string right)
        {
            StringComparison comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            return string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(left)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(right)), comparison);
        }

        private static string FindProject(string? path)
        {
            if (path != null)
            {
                string root = Path.GetFullPath(path);
                if (!Directory.Exists(Path.Combine(root, "Assets")) || !Directory.Exists(Path.Combine(root, "ProjectSettings")))
                {
                    throw new InvalidOperationException("--project must point to the Unity project containing Assets and ProjectSettings.");
                }

                return root;
            }

            DirectoryInfo? current = new DirectoryInfo(Directory.GetCurrentDirectory());
            while (current != null)
            {
                if (Directory.Exists(Path.Combine(current.FullName, "Assets")) && Directory.Exists(Path.Combine(current.FullName, "ProjectSettings")))
                {
                    return current.FullName;
                }

                current = current.Parent;
            }

            throw new InvalidOperationException("Unity project not found. Specify --project <path>.");
        }

        private sealed class Endpoint
        {
            public int ProtocolVersion
            { get; set; }

            public string PipeName
            { get; set; } = "";

            public string Token
            { get; set; } = "";

            public string ProjectPath
            { get; set; } = "";

            public int Pid
            { get; set; }
        }
    }

    internal sealed class PingResponse
    {
        public bool Ok
        { get; set; }

        public string Message
        { get; set; } = "";

        public string? Error
        { get; set; }

        public string? ProjectPath
        { get; set; }

        public string? UnityVersion
        { get; set; }

        public int Pid
        { get; set; }

        public string? RespondedAtUtc
        { get; set; }
    }
}
