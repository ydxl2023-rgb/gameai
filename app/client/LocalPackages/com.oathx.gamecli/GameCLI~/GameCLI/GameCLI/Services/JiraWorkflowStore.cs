using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

using GameCLI.Contracts;

namespace GameCLI.Services
{
    /// <summary>Persists workflow state and resolves task identities against JIRA, never a local database.</summary>
    internal sealed class JiraWorkflowStore
    {
        private const string PropertyName = "gamecli.workflow.v1";

        private const string BootstrapMarker = "\nGAMECLI_WORKFLOW_BOOTSTRAP\n";

        private readonly HttpClient http;

        private readonly JiraConnection connection;

        private readonly Action guard;

        private readonly string? issueType;

        public JiraWorkflowStore(HttpClient http, JiraConnection connection, Action guard, string? issueType)
        {
            this.http = http;
            this.connection = connection;
            this.guard = guard;
            this.issueType = issueType;
        }

        public string ProjectKey => connection.ProjectKey;

        public string? LastCreatedIssueKey
        { get; private set; }

        public string? RecoveryLabel
        { get; private set; }

        public string IssueUrl(string key) => connection.Address + "/browse/" + Uri.EscapeDataString(key);

        /// <summary>Reads native workflow completion instead of inferring it from description text.</summary>
        public async Task<JiraTaskState> ReadTaskStateAsync(string key, CancellationToken cancellation)
        {
            ValidateKey(key);
            JsonElement issue = await SendAsync(HttpMethod.Get, "issue/" + key + "?fields=status,updated", null, cancellation);
            JsonElement fields = issue.GetProperty("fields");
            return new JiraTaskState(fields.GetProperty("status").GetProperty("statusCategory").GetProperty("key").GetString() == "done", DateTimeOffset.Parse(fields.GetProperty("updated").GetString()!, System.Globalization.CultureInfo.InvariantCulture));
        }

        /// <summary>Missing records mean work has not been dispatched, never that it has completed.</summary>
        public async Task<TaskDelivery?> ReadDeliveryAsync(string key, CancellationToken cancellation)
        {
            ValidateKey(key);
            JsonElement property = await SendAsync(HttpMethod.Get, "issue/" + key + "/properties/gamecli.delivery.v1", null, cancellation, true);
            if (property.ValueKind == JsonValueKind.Undefined)
            {
                return null;
            }

            TaskDelivery delivery = WorkflowContract.Parse<TaskDelivery>(property.GetProperty("value").GetRawText());
            delivery.Validate();
            if (delivery.IssueKey != key)
            {
                throw new JsonException("交付记录不属于当前子任务。");
            }

            return delivery;
        }

        /// <summary>Resolves an unambiguous completion transition from the project's actual workflow.</summary>
        public async Task<string> CompletionTransitionAsync(string key, CancellationToken cancellation)
        {
            ValidateKey(key);
            JsonElement result = await SendAsync(HttpMethod.Get, "issue/" + key + "/transitions", null, cancellation);
            JsonElement[] transitions = result.GetProperty("transitions").EnumerateArray().Where(item => item.GetProperty("to").GetProperty("statusCategory").GetProperty("key").GetString() == "done").ToArray();
            if (transitions.Length != 1)
            {
                throw new JiraTaskException("当前程序任务没有唯一可用的完成转换，请检查项目工作流：" + key, 3);
            }

            return transitions[0].GetProperty("id").GetString() ?? throw new JsonException("缺少状态转换编号。");
        }

        /// <summary>The caller must persist the completion intent first and reconcile uncertain responses.</summary>
        public async Task CompleteTaskAsync(string key, string transition, CancellationToken cancellation)
        {
            ValidateKey(key);
            await SendAsync(HttpMethod.Post, "issue/" + key + "/transitions", JsonSerializer.Serialize(new
            {
                transition = new
                {
                    id = transition
                }
            }), cancellation);
        }

        /// <summary>Writes execution evidence and its readable projection in one JIRA issue update.</summary>
        public async Task SaveDeliveryAsync(Workflow state, PlannedTask task, CreatedTask created, TaskDelivery delivery, CancellationToken cancellation)
        {
            delivery.Validate();
            await VerifyTaskAsync(state, task, created, cancellation);
            string json = WorkflowContract.Serialize(delivery);
            if (Encoding.UTF8.GetByteCount(json) > 32000)
            {
                throw new JiraTaskException("交付清单超过单据属性容量，请减少清单并将详细内容放入报告文件。", 4);
            }

            await SendAsync(HttpMethod.Put, "issue/" + created.Key, JsonSerializer.Serialize(new
            {
                fields = new
                {
                    description = JiraIssueDescription.Task(state, task, IssueUrl(state.IssueKey)) + JiraIssueDescription.Delivery(delivery)
                },
                properties = new[]
                {
                    new
                    {
                        key = "gamecli.delivery.v1",
                        value = JsonSerializer.Deserialize<JsonElement>(json)
                    }
                }
            }), cancellation);
        }

        /// <summary>Finds an existing document marker or creates an entry containing a recoverable initial snapshot.</summary>
        public async Task<Workflow> StartAsync(string document, CancellationToken cancellation)
        {
            Workflow state = new()
            {
                ProjectKey = connection.ProjectKey,
                IssueType = issueType,
                Document = document,
                DocumentHash = WorkflowContract.Hash(document)
            };
            string label = "gamecli-document-" + state.DocumentHash[..32];
            RecoveryLabel = label;
            JsonElement matches = await SearchLabelAsync(state.ProjectKey, label, cancellation);
            if (matches.GetProperty("total").GetInt32() > 1)
            {
                throw new JiraTaskException("Multiple workflows exist for this document. Select the correct issue using --status and --resume.", 3);
            }

            if (matches.GetProperty("issues").GetArrayLength() == 1)
            {
                string key = matches.GetProperty("issues")[0].GetProperty("key").GetString() ?? throw new JsonException("Missing workflow key.");
                LastCreatedIssueKey = key;
                Workflow existing = await LoadAsync(key, cancellation);
                if (existing.DocumentHash != state.DocumentHash)
                {
                    throw new JiraTaskException("This document already belongs to a revised workflow: " + key + ". Use --status to review it.", 3);
                }

                return existing;
            }

            string bootstrap = Encode(state);
            guard();
            Console.Error.WriteLine("Registering workflow " + state.Id + "; recovery label: " + label);
            // Store the initial snapshot in the creation payload so a later property-write failure is recoverable.
            JiraTaskResult root = await new JiraTaskClient(http).CreateAsync(connection.Address, connection.Token, connection.ProjectKey, JiraIssueDescription.Title(state), JiraIssueDescription.Workflow(state), issueType, cancellation, new[]
            {
                "gamecli-workflow",
                "gamecli-run-" + state.Id,
                label
            }, new Dictionary<string, object>
            {
                [PropertyName] = JsonSerializer.Deserialize<JsonElement>(bootstrap)
            });
            state.IssueKey = root.Key;
            LastCreatedIssueKey = root.Key;
            Console.Error.WriteLine("Workflow: " + root.Key + " " + root.Url);
            await SaveAsync(state, cancellation);
            return state;
        }

        /// <summary>Loads and validates the authoritative issue property, falling back only to its creation bootstrap.</summary>
        public async Task<Workflow> LoadAsync(string key, CancellationToken cancellation)
        {
            ValidateKey(key);
            JsonElement issue = await SendAsync(HttpMethod.Get, "issue/" + key + "?fields=project,description,labels", null, cancellation);
            if (!string.Equals(issue.GetProperty("fields").GetProperty("project").GetProperty("key").GetString(), connection.ProjectKey, StringComparison.OrdinalIgnoreCase))
            {
                throw new JiraTaskException("Workflow belongs to a different configured JIRA project.", 3);
            }

            JsonElement property = await SendAsync(HttpMethod.Get, "issue/" + key + "/properties/" + PropertyName, null, cancellation, true);
            Workflow state;
            if (property.ValueKind == JsonValueKind.Undefined)
            {
                string description = issue.GetProperty("fields").GetProperty("description").GetString() ?? "";
                int marker = description.IndexOf(BootstrapMarker, StringComparison.Ordinal);
                if (marker < 0)
                {
                    throw new JiraTaskException("Issue is not a GameCLI workflow.", 4);
                }

                state = WorkflowContract.Parse<Workflow>(description[(marker + BootstrapMarker.Length)..]);
                state.IssueKey = key;
            }
            else
            {
                state = WorkflowContract.Parse<Workflow>(property.GetProperty("value").GetRawText());
                // The creation snapshot cannot know its issue key until the POST completes.
                if (state.IssueKey == "" && state.Stage == "design_pending" && state.Design == null && state.Executions.Count == 0 && issue.GetProperty("fields").GetProperty("labels").EnumerateArray().Any(label => label.GetString() == "gamecli-run-" + state.Id))
                {
                    state.IssueKey = key;
                }
            }

            if (state.SchemaVersion != 1 || state.IssueKey != key || !string.Equals(state.ProjectKey, connection.ProjectKey, StringComparison.OrdinalIgnoreCase) || state.DocumentHash != WorkflowContract.Hash(state.Document))
            {
                throw new JsonException("Invalid workflow identity or document version in JIRA.");
            }

            WorkflowContract.ValidateWorkflow(state);
            return state;
        }

        /// <summary>Writes a size-bounded snapshot to JIRA; the caller must hold the single-controller lease.</summary>
        public async Task SaveAsync(Workflow state, CancellationToken cancellation)
        {
            ValidateKey(state.IssueKey);
            string json = Encode(state);
            string body = JsonSerializer.Serialize(new
            {
                fields = new
                {
                    summary = JiraIssueDescription.Title(state),
                    description = JiraIssueDescription.Workflow(state)
                },
                properties = new[]
                {
                    new
                    {
                        key = PropertyName,
                        value = JsonSerializer.Deserialize<JsonElement>(json)
                    }
                }
            });
            await SendAsync(HttpMethod.Put, "issue/" + state.IssueKey, body, cancellation);
        }

        /// <summary>Returns the authenticated JIRA identity used to attribute an explicit caller approval.</summary>
        public async Task<string> CurrentUserAsync(CancellationToken cancellation)
        {
            JsonElement user = await SendAsync(HttpMethod.Get, "myself", null, cancellation);
            foreach (string name in new[]
            {
                "key",
                "name",
                "accountId"
            })
            {
                if (user.TryGetProperty(name, out JsonElement value) && !string.IsNullOrWhiteSpace(value.GetString()))
                {
                    return value.GetString()!;
                }
            }

            throw new JsonException("JIRA did not return an approver identity.");
        }

        /// <summary>Searches the stable task marker and refuses ambiguous duplicate matches.</summary>
        public async Task<CreatedTask?> FindTaskAsync(Workflow state, PlannedTask task, CancellationToken cancellation)
        {
            JsonElement result = await SearchLabelAsync(state.ProjectKey, TaskLabel(state, task), cancellation);
            JsonElement[] issues = result.GetProperty("issues").EnumerateArray().ToArray();
            if (result.GetProperty("total").GetInt32() > 1)
            {
                throw new JiraTaskException("Duplicate task marker in JIRA. Resolve duplicates before resuming.", 3);
            }

            if (issues.Length == 0)
            {
                return null;
            }

            string key = issues[0].GetProperty("key").GetString() ?? throw new JsonException("Missing issue key.");
            return new CreatedTask(task.Id, key, IssueUrl(key));
        }

        /// <summary>Creates one professional task with its marker in the same POST as the task content.</summary>
        public async Task<CreatedTask> CreateTaskAsync(Workflow state, PlannedTask task, CancellationToken cancellation)
        {
            guard();
            string description = JiraIssueDescription.Task(state, task, IssueUrl(state.IssueKey));
            JiraTaskResult result = await new JiraTaskClient(http).CreateAsync(connection.Address, connection.Token, state.ProjectKey, "【" + JiraIssueDescription.Role(task.Role) + "】" + task.Title, description, null, cancellation, new[]
            {
                "gamecli-run-" + state.Id,
                TaskLabel(state, task),
                "gamecli-role-" + task.Role.ToLowerInvariant()
            }, parentKey: state.IssueKey);
            return new CreatedTask(task.Id, result.Key, result.Url);
        }

        /// <summary>Checks the recorded issue still belongs to the intended project and task identity.</summary>
        public async Task VerifyTaskAsync(Workflow state, PlannedTask task, CreatedTask created, CancellationToken cancellation)
        {
            ValidateKey(created.Key);
            JsonElement issue = await SendAsync(HttpMethod.Get, "issue/" + created.Key + "?fields=labels,project,issuetype,parent", null, cancellation);
            JsonElement fields = issue.GetProperty("fields");
            if (!fields.GetProperty("issuetype").GetProperty("subtask").GetBoolean() || !fields.TryGetProperty("parent", out JsonElement parent) || parent.GetProperty("key").GetString() != state.IssueKey)
            {
                throw new JiraTaskException("专业单据必须是当前需求主任务的真实子任务，请先转换已有独立任务：" + created.Key, 3);
            }

            if (!fields.GetProperty("labels").EnumerateArray().Any(label => label.GetString() == TaskLabel(state, task)) || !string.Equals(fields.GetProperty("project").GetProperty("key").GetString(), state.ProjectKey, StringComparison.OrdinalIgnoreCase))
            {
                throw new JiraTaskException("Created task identity changed in JIRA: " + created.Key, 3);
            }
        }

        private static string TaskLabel(Workflow state, PlannedTask task)
        {
            string revision = task.Id == "art-requirements" ? "art" : task.Id is "development-requirements" or "qa-requirements" ? "early" : state.Revision;
            return "gamecli-task-" + WorkflowContract.Hash(state.Id + "\n" + revision + "\n" + task.Id)[..32];
        }

        /// <summary>Refreshes a verified early art issue after the design changes, preserving its identity.</summary>
        public async Task UpdateArtAsync(Workflow state, CancellationToken cancellation)
        {
            await VerifyTaskAsync(state, state.ArtTask!, state.ArtCreated!, cancellation);
            string description = state.Design!.ArtRequirements.Length == 0 ? "h3. 需求范围\n* 本次需求修订已移除美术需求，请勿继续按旧内容制作。" : JiraIssueDescription.Task(state, state.ArtTask!, IssueUrl(state.IssueKey));
            await SendAsync(HttpMethod.Put, "issue/" + state.ArtCreated!.Key, JsonSerializer.Serialize(new
            {
                fields = new
                {
                    summary = "【美术】" + state.ArtTask!.Title,
                    description
                }
            }), cancellation);
        }

        /// <summary>Updates an existing registered scope after verifying its stable identity.</summary>
        public async Task UpdateTaskAsync(Workflow state, PlannedTask task, CreatedTask created, CancellationToken cancellation)
        {
            await VerifyTaskAsync(state, task, created, cancellation);
            await SendAsync(HttpMethod.Put, "issue/" + created.Key, JsonSerializer.Serialize(new
            {
                fields = new
                {
                    summary = "【" + JiraIssueDescription.Role(task.Role) + "】" + task.Title,
                    description = JiraIssueDescription.Task(state, task, IssueUrl(state.IssueKey))
                }
            }), cancellation);
        }

        private Task<JsonElement> SearchLabelAsync(string projectKey, string label, CancellationToken cancellation)
        {
            string jql = "project = \"" + projectKey.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\" AND labels = \"" + label + "\"";
            return SendAsync(HttpMethod.Get, "search?jql=" + Uri.EscapeDataString(jql) + "&fields=summary,labels&maxResults=2", null, cancellation);
        }

        private static string Encode(Workflow state)
        {
            string json = WorkflowContract.Serialize(state);
            if (Encoding.UTF8.GetByteCount(json) > 32000)
            {
                throw new JiraTaskException("Workflow snapshot exceeds 32000 bytes. Use a smaller requirement document or task plan.", 4);
            }

            return json;
        }

        private static void ValidateKey(string key)
        {
            if (!Regex.IsMatch(key, "^[A-Za-z][A-Za-z0-9_]*-[0-9]+$"))
            {
                throw new ArgumentException("Invalid JIRA issue key.");
            }
        }

        private async Task<JsonElement> SendAsync(HttpMethod method, string path, string? body, CancellationToken cancellation, bool missingAllowed = false)
        {
            guard();
            using HttpRequestMessage request = JiraTaskClient.Request(method, connection.Address + "/rest/api/2/" + path, connection.Token);
            if (body != null)
            {
                request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            }

            using HttpResponseMessage response = await http.SendAsync(request, cancellation);
            string json = await response.Content.ReadAsStringAsync(cancellation);
            if (missingAllowed && response.StatusCode == HttpStatusCode.NotFound)
            {
                return default;
            }

            JiraTaskClient.CheckResponse(response, json, connection.Token);
            if (string.IsNullOrWhiteSpace(json))
            {
                return default;
            }

            using JsonDocument document = JsonDocument.Parse(json);
            return document.RootElement.Clone();
        }
    }
}
