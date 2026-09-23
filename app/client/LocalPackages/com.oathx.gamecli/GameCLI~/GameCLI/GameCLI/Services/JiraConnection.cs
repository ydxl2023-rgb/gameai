using System.Text.Json;

using GameCLI.Contracts;
using Oathx.GameCLI.Editor;

namespace GameCLI.Services
{
    /// <summary>Loads the same server-scoped Windows credential used by the PM configuration panel.</summary>
    internal sealed class JiraConnection
    {
        public string Address
        { get; }

        public string ProjectKey
        { get; }

        internal string Token
        { get; }

        public JiraConnection(string address, string projectKey, string token)
        {
            Address = address;
            ProjectKey = projectKey;
            Token = token;
        }

        public static async Task<JiraConnection> LoadAsync(CancellationToken cancellation)
        {
            if (!OperatingSystem.IsWindows())
            {
                throw new JiraTaskException("Saved JIRA credentials require Windows.", 5);
            }

            string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gamecli", "jira.json");
            using JsonDocument settings = JsonDocument.Parse(await File.ReadAllTextAsync(path, cancellation));
            string? address = settings.RootElement.GetProperty("address").GetString()?.Trim();
            string? key = settings.RootElement.TryGetProperty("projectKey", out JsonElement project) ? project.GetString()?.Trim() : null;
            if (!Uri.TryCreate(address, UriKind.Absolute, out Uri? uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0 || string.IsNullOrWhiteSpace(key))
            {
                throw new JiraTaskException("Save a valid JIRA Address and Project Key in the PM panel.", 5);
            }

            address = uri.AbsoluteUri.TrimEnd('/');
            string target = "GameCLI/Jira/" + WorkflowContract.Hash(address + "\n\nBearer").ToUpperInvariant();
            string token = WindowsCredentialStore.Read(target) ?? throw new JiraTaskException("Save the JIRA access token in the PM panel.", 5);
            return new JiraConnection(address, key, token);
        }
    }
}
