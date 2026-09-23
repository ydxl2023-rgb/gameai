using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace GameCLI.Services
{
    internal sealed record JiraTaskResult(string Key, string Url);

    internal sealed class JiraTaskException : Exception
    {
        public int ExitCode
        { get; }

        public bool OutcomeUnknown
        { get; }

        public JiraTaskException(string message, int exitCode, bool outcomeUnknown = false) : base(message)
        {
            ExitCode = exitCode;
            OutcomeUnknown = outcomeUnknown;
        }
    }

    /// <summary>Creates one task without retrying a potentially accepted POST.</summary>
    internal sealed class JiraTaskClient
    {
        private readonly HttpClient http;

        public JiraTaskClient(HttpClient http)
        {
            this.http = http;
        }

        /// <summary>Resolves the appropriate issue type and validates parent identity before creating a subtask.</summary>
        /// <remarks>The caller owns the HTTP client and deadline. A failed POST transport has an unknown outcome.</remarks>
        public async Task<JiraTaskResult> CreateAsync(string address, string token, string projectKey, string summary, string? description, string? issueType, CancellationToken cancellation, string[]? labels = null, Dictionary<string, object>? properties = null, string? parentKey = null)
        {
            if (string.IsNullOrWhiteSpace(projectKey) || string.IsNullOrWhiteSpace(summary) || summary.Trim().Length > 255)
            {
                throw new ArgumentException("Project Key and a title of 1 to 255 characters are required.");
            }

            if (string.IsNullOrWhiteSpace(token) || token.Contains('\r') || token.Contains('\n'))
            {
                throw new ArgumentException("A valid saved access token is required.");
            }

            using HttpRequestMessage lookup = Request(HttpMethod.Get, address + "/rest/api/2/project/" + Uri.EscapeDataString(projectKey.Trim()), token);
            using HttpResponseMessage projectResponse = await http.SendAsync(lookup, cancellation);
            string projectJson = await projectResponse.Content.ReadAsStringAsync(cancellation);
            CheckResponse(projectResponse, projectJson, token);
            using JsonDocument project = JsonDocument.Parse(projectJson);
            string typeId = FindType(project.RootElement, issueType, parentKey != null);
            string canonicalKey = project.RootElement.GetProperty("key").GetString() ?? throw new JiraTaskException("JIRA did not return a project key.", 5);
            Dictionary<string, object> fields = new()
            {
                ["project"] = new
                {
                    key = canonicalKey
                },
                ["issuetype"] = new
                {
                    id = typeId
                },
                ["summary"] = summary.Trim()
            };
            if (parentKey != null)
            {
                using HttpRequestMessage parentRequest = Request(HttpMethod.Get, address + "/rest/api/2/issue/" + Uri.EscapeDataString(parentKey) + "?fields=project,issuetype", token);
                using HttpResponseMessage parentResponse = await http.SendAsync(parentRequest, cancellation);
                string parentJson = await parentResponse.Content.ReadAsStringAsync(cancellation);
                CheckResponse(parentResponse, parentJson, token);
                using JsonDocument parent = JsonDocument.Parse(parentJson);
                JsonElement parentFields = parent.RootElement.GetProperty("fields");
                if (parentFields.GetProperty("issuetype").GetProperty("subtask").GetBoolean() || !string.Equals(parentFields.GetProperty("project").GetProperty("key").GetString(), canonicalKey, StringComparison.OrdinalIgnoreCase))
                {
                    throw new JiraTaskException("Parent must be a standard issue in the configured project.", 4);
                }

                fields["parent"] = new
                {
                    key = parent.RootElement.GetProperty("key").GetString()
                };
            }

            if (!string.IsNullOrWhiteSpace(description))
            {
                fields["description"] = description;
            }

            if (labels != null)
            {
                fields["labels"] = labels;
            }

            Dictionary<string, object> payload = new()
            {
                ["fields"] = fields
            };
            if (properties != null)
            {
                payload["properties"] = properties.Select(property => new
                {
                    key = property.Key,
                    value = property.Value
                }).ToArray();
            }

            using HttpRequestMessage create = Request(HttpMethod.Post, address + "/rest/api/2/issue", token);
            create.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            cancellation.ThrowIfCancellationRequested();
            try
            {
                // Once POST starts, a lost response must never trigger an automatic second creation.
                using HttpResponseMessage response = await http.SendAsync(create, cancellation);
                string json = await response.Content.ReadAsStringAsync(cancellation);
                if ((int)response.StatusCode >= 500 || response.StatusCode == HttpStatusCode.RequestTimeout)
                {
                    throw UnknownOutcome();
                }

                CheckResponse(response, json, token);
                if (response.StatusCode != HttpStatusCode.Created)
                {
                    throw UnknownOutcome();
                }

                using JsonDocument result = JsonDocument.Parse(json);
                string? key = result.RootElement.GetProperty("key").GetString();
                if (string.IsNullOrWhiteSpace(key))
                {
                    throw UnknownOutcome();
                }

                return new JiraTaskResult(key, address + "/browse/" + Uri.EscapeDataString(key));
            }
            catch (Exception exception) when (exception is HttpRequestException or IOException or OperationCanceledException or JsonException or KeyNotFoundException or InvalidOperationException)
            {
                throw UnknownOutcome();
            }
        }

        internal static HttpRequestMessage Request(HttpMethod method, string url, string token)
        {
            HttpRequestMessage request = new(method, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            return request;
        }

        private static string FindType(JsonElement project, string? requested, bool subtask)
        {
            List<JsonElement> candidates = project.GetProperty("issueTypes").EnumerateArray().Where(type => type.GetProperty("subtask").GetBoolean() == subtask).ToList();
            if (subtask && string.IsNullOrWhiteSpace(requested) && candidates.Count == 1)
            {
                return candidates[0].GetProperty("id").GetString()!;
            }

            foreach (JsonElement type in candidates)
            {
                string? id = type.GetProperty("id").GetString();
                string? name = type.GetProperty("name").GetString();
                bool match = string.IsNullOrWhiteSpace(requested) ? subtask ? name is "Sub-task" or "Subtask" or "子任务" : string.Equals(name, "Task", StringComparison.OrdinalIgnoreCase) || name == "任务" : id == requested || string.Equals(name, requested, StringComparison.OrdinalIgnoreCase);
                if (match && !string.IsNullOrWhiteSpace(id))
                {
                    return id;
                }
            }

            throw new JiraTaskException(subtask ? "项目未配置可用的子任务类型，请先配置子任务；不会降级创建独立任务。" : "No matching Task issue type in this project. Configure Task in JIRA or pass --issue-type <name-or-id>.", 5);
        }

        private static JiraTaskException UnknownOutcome()
        {
            return new JiraTaskException("Creation outcome is unknown. Check JIRA for the task before submitting again; no automatic retry was performed.", 3, true);
        }

        internal static void CheckResponse(HttpResponseMessage response, string json, string token)
        {
            if (response.IsSuccessStatusCode)
            {
                return;
            }

            int status = (int)response.StatusCode;
            string details = "";
            try
            {
                using JsonDocument document = JsonDocument.Parse(json);
                List<string> errors = new();
                if (document.RootElement.TryGetProperty("errors", out JsonElement fields) && fields.ValueKind == JsonValueKind.Object)
                {
                    errors.AddRange(fields.EnumerateObject().Select(field => field.Name + ": " + field.Value.ToString()));
                }

                if (document.RootElement.TryGetProperty("errorMessages", out JsonElement messages) && messages.ValueKind == JsonValueKind.Array)
                {
                    errors.AddRange(messages.EnumerateArray().Select(message => message.ToString()));
                }

                details = string.Join("; ", errors).Replace(token, "[redacted]", StringComparison.Ordinal);
                details = details[..Math.Min(details.Length, 1500)];
            }
            catch (JsonException)
            {
                // HTML login/error pages are not safe or useful CLI diagnostics.
            }

            int code = status is 401 or 403 ? 3 : status == 400 ? 2 : 5;
            throw new JiraTaskException($"JIRA request failed (HTTP {status}). {details}".Trim(), code);
        }
    }
}
