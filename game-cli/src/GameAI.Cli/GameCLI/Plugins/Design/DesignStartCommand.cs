using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

using GameCLI.Abstractions;

namespace GameCLI.Plugins.Design
{
    internal sealed class DesignStartCommand : ICommand
    {
        public string Name => "start";

        public string Description => "Queue an approved draft with durable server-owned recovery, or query/cancel its request.";

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            const string usage = "GameCLI design start --server <url> --request-id <UUID> --key <KEY> --version <version> --prompt-file <file> --approval-file <approved draft reference> [--source-document <HTML>] [--window-spec <JSON>] | --server <url> --request-id <UUID> --action <status|cancel>. Starting grants this request up to three execution attempts; it never approves the resulting HTML.";
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine(usage);
                return 0;
            }
            try
            {
                Dictionary<string, string> values = new(StringComparer.Ordinal);
                for (int i = 0; i < args.Length; i += 2)
                {
                    if (i + 1 >= args.Length || args[i] is not ("--server" or "--request-id" or "--key" or "--version" or "--prompt-file" or "--approval-file" or "--source-document" or "--window-spec" or "--action") || !values.TryAdd(args[i], args[i + 1]))
                    {
                        throw new ArgumentException(usage);
                    }
                }
                Uri endpoint = new(values["--server"].TrimEnd('/') + "/api/track/design-jobs");
                if (endpoint.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(endpoint.UserInfo) || !string.IsNullOrEmpty(endpoint.Query) || !string.IsNullOrEmpty(endpoint.Fragment))
                {
                    throw new ArgumentException("Invalid server URL.");
                }
                Dictionary<string, object> payload = new()
                {
                    ["request_id"] = Guid.Parse(values["--request-id"]).ToString()
                };
                if (values.TryGetValue("--action", out string? action))
                {
                    if (action is not ("status" or "cancel"))
                    {
                        throw new ArgumentException("Action must be status or cancel.");
                    }
                    payload["action"] = action;
                }
                else
                {
                    payload["requirement_key"] = values["--key"];
                    payload["version"] = values["--version"];
                    payload["prompt"] = await File.ReadAllTextAsync(values["--prompt-file"], cancellationToken);
                    payload["draft_approval"] = await File.ReadAllTextAsync(values["--approval-file"], cancellationToken);
                    payload["recovery_authorized"] = true;
                    foreach ((string option, string field) in new[] { ("--source-document", "source_html"), ("--window-spec", "windows_json") })
                    {
                        if (values.TryGetValue(option, out string? file))
                        {
                            payload[field] = await File.ReadAllTextAsync(file, cancellationToken);
                        }
                    }
                }
                using HttpClient http = new() { Timeout = TimeSpan.FromSeconds(30) };
                string token = Environment.GetEnvironmentVariable("GAMEAI_SUBMISSION_TOKEN") ?? throw new InvalidOperationException("GAMEAI_SUBMISSION_TOKEN is missing.");
                http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using StringContent content = new(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                using HttpResponseMessage response = await http.PostAsync(endpoint, content, cancellationToken);
                string body = await response.Content.ReadAsStringAsync(cancellationToken);
                if (!response.IsSuccessStatusCode)
                {
                    throw new InvalidOperationException("Design request rejected: " + body);
                }
                Console.WriteLine(body);
                return 0;
            }
            catch (Exception exception) when (exception is ArgumentException or KeyNotFoundException or IOException or InvalidOperationException or HttpRequestException or OperationCanceledException or FormatException)
            {
                Console.Error.WriteLine(exception.Message);
                Console.Error.WriteLine("Keep the same request ID when checking or retrying this request.");
                return 3;
            }
        }
    }
}
