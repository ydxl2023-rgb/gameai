using System.ComponentModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using GameCLI.Abstractions;
using GameCLI.Services;
using Oathx.GameCLI.Editor;

namespace GameCLI.Plugins.Jira
{
    internal sealed class JiraCreateCommand : ICommand
    {
        private const string Usage = "GameCLI jira --create --summary <title> [--description <text>] [--parent <KEY>] [--issue-type <name-or-id>] [--format human|json]";

        /// <inheritdoc />
        public string Name => "create";

        /// <inheritdoc />
        public string Description => "Create one task in the saved JIRA project.";

        /// <inheritdoc />
        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine(Usage);
                return 0;
            }

            bool json = args.Zip(args.Skip(1)).Any(pair => pair.First == "--format" && pair.Second == "json");
            try
            {
                Dictionary<string, string> options = new(StringComparer.Ordinal);
                for (int i = 0; i < args.Length; i += 2)
                {
                    if (i + 1 >= args.Length || args[i] is not ("--summary" or "--description" or "--parent" or "--issue-type" or "--format") || !options.TryAdd(args[i], args[i + 1]))
                    {
                        throw new ArgumentException(Usage);
                    }
                }

                if (!options.TryGetValue("--summary", out string? summary) || string.IsNullOrWhiteSpace(summary) || summary.Trim().Length > 255 || options.GetValueOrDefault("--format", "human") is not ("human" or "json"))
                {
                    throw new ArgumentException("A title of 1 to 255 characters and --format human|json are required. " + Usage);
                }

                if (!OperatingSystem.IsWindows())
                {
                    throw new JiraTaskException("Saved JIRA credentials currently require Windows.", 5);
                }

                string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gamecli", "jira.json");
                using JsonDocument settings = JsonDocument.Parse(await File.ReadAllTextAsync(path, cancellationToken));
                string? address = settings.RootElement.GetProperty("address").GetString();
                string? projectKey = settings.RootElement.TryGetProperty("projectKey", out JsonElement key) ? key.GetString()?.Trim() : null;
                if (!Uri.TryCreate(address?.Trim(), UriKind.Absolute, out Uri? uri) || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) || string.IsNullOrWhiteSpace(projectKey))
                {
                    throw new JiraTaskException("Save a valid JIRA Address and Project Key in the PM panel first.", 5);
                }

                address = uri.AbsoluteUri.TrimEnd('/');
                // Match the Editor's server-scoped credential key; the token never becomes a CLI argument.
                string target = "GameCLI/Jira/" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(address + "\n\nBearer")));
                string token = WindowsCredentialStore.Read(target) ?? throw new JiraTaskException("Save the access token in the PM panel first.", 5);
                using HttpClientHandler handler = new()
                {
                    AllowAutoRedirect = false,
                    UseCookies = false
                };
                using HttpClient http = new(handler)
                {
                    Timeout = TimeSpan.FromSeconds(30),
                    MaxResponseContentBufferSize = 1024 * 1024
                };
                JiraTaskResult result = await new JiraTaskClient(http).CreateAsync(address, token, projectKey, summary, options.GetValueOrDefault("--description"), options.GetValueOrDefault("--issue-type"), cancellationToken, parentKey: options.GetValueOrDefault("--parent"));
                Console.WriteLine(json ? JsonSerializer.Serialize(new
                {
                    ok = true,
                    key = result.Key,
                    url = result.Url
                }) : result.Key + "\n" + result.Url);
                return 0;
            }
            catch (Exception exception) when (exception is JiraTaskException or ArgumentException or IOException or UnauthorizedAccessException or JsonException or KeyNotFoundException or InvalidOperationException or Win32Exception or HttpRequestException or OperationCanceledException)
            {
                bool unknown = exception is JiraTaskException taskError && taskError.OutcomeUnknown;
                int code = exception is JiraTaskException failure ? failure.ExitCode : exception is ArgumentException ? 4 : exception is HttpRequestException or OperationCanceledException ? 1 : 5;
                string message = exception is JiraTaskException or ArgumentException ? exception.Message : "Could not load the saved JIRA connection or query the project. Check configuration, credentials and connectivity.";
                if (json)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new
                    {
                        ok = false,
                        exit_code = code,
                        outcome_unknown = unknown,
                        message
                    }));
                }

                Console.Error.WriteLine(message);
                return code;
            }
        }
    }
}
