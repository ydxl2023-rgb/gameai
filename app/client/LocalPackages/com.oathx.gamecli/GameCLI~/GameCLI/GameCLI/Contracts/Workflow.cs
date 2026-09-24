using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace GameCLI.Contracts
{
    internal sealed record DesignBrief(string Title, string Specification, string[] Acceptance, string[] ArtRequirements, string[] DevelopmentRequirements, string[] Questions);

    internal sealed record PlannedTask(string Id, string Role, string Title, string Description, string[] Acceptance, string[] DependsOn);

    internal sealed record TaskPlan(PlannedTask[] Tasks);

    internal sealed record CreatedTask(string Id, string Key, string Url);

    internal sealed record AgentExecution(string Role, string ExecutionId, string ThreadId, string TurnId, string Status, DateTimeOffset StartedAt);

    internal sealed class EarlyTaskPublication
    {
        public PlannedTask Task
        { get; set; } = null!;

        public CreatedTask? Created
        { get; set; }

        public bool Pending
        { get; set; }
    }

    /// <summary>Authoritative workflow snapshot stored only in a JIRA issue property.</summary>
    internal sealed class Workflow
    {
        public int SchemaVersion
        { get; set; } = 1;

        public string Id
        { get; set; } = Guid.NewGuid().ToString("N");

        public string IssueKey
        { get; set; } = "";

        public string ProjectKey
        { get; set; } = "";

        public string? IssueType
        { get; set; }

        public string Stage
        { get; set; } = "design_pending";

        public string Document
        { get; set; } = "";

        public string DocumentHash
        { get; set; } = "";

        public DesignBrief? Design
        { get; set; }

        public string[] SuggestedRules
        { get; set; } = Array.Empty<string>();

        public string Revision
        { get; set; } = "";

        public string? ApprovedRevision
        { get; set; }

        public string? ApprovedBy
        { get; set; }

        public DateTimeOffset? ApprovedAt
        { get; set; }

        public TaskPlan? Plan
        { get; set; }

        public PlannedTask? ArtTask
        { get; set; }

        public CreatedTask? ArtCreated
        { get; set; }

        public bool ArtPending
        { get; set; }

        public List<EarlyTaskPublication> EarlyTasks
        { get; set; } = new();

        public List<CreatedTask> Created
        { get; set; } = new();

        public string? PendingTask
        { get; set; }

        public List<AgentExecution> Executions
        { get; set; } = new();
    }

    internal static class WorkflowContract
    {
        public static readonly JsonSerializerOptions Json = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
        };

        public static object Text => new
        {
            type = "string"
        };

        public static object TextList => new
        {
            type = "array",
            items = Text
        };

        public static object DesignSchema => ObjectSchema(new()
        {
            ["title"] = Text,
            ["specification"] = Text,
            ["acceptance"] = TextList,
            ["art_requirements"] = TextList,
            ["development_requirements"] = TextList,
            ["questions"] = TextList
        });

        public static object PlanSchema => ObjectSchema(new()
        {
            ["tasks"] = new
            {
                type = "array",
                items = ObjectSchema(new()
                {
                    ["id"] = Text,
                    ["role"] = new
                    {
                        type = "string",
                        @enum = new[]
                        {
                            "Art",
                            "Development",
                            "QA"
                        }
                    },
                    ["title"] = Text,
                    ["description"] = Text,
                    ["acceptance"] = TextList,
                    ["depends_on"] = TextList
                })
            }
        });

        public static object ObjectSchema(Dictionary<string, object> properties)
        {
            return new
            {
                type = "object",
                properties,
                required = properties.Keys.ToArray(),
                additionalProperties = false
            };
        }

        public static string Hash(string text)
        {
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
        }

        public static string Serialize<T>(T value)
        {
            return JsonSerializer.Serialize(value, Json);
        }

        public static T Parse<T>(string text)
        {
            return JsonSerializer.Deserialize<T>(text, Json) ?? throw new JsonException("Missing structured result.");
        }

        public static void ValidateDesign(DesignBrief design)
        {
            RequireText(design.Title, 200);
            RequireText(design.Specification, 6000);
            RequireList(design.Questions, false);
            // Discussion drafts may lack executable scope; approval still requires a complete design.
            bool complete = design.Questions.Length == 0;
            RequireList(design.Acceptance, complete);
            RequireList(design.ArtRequirements, false);
            RequireList(design.DevelopmentRequirements, complete);
        }

        /// <summary>Rejects malformed persisted state before it can authorize execution or suppress task creation.</summary>
        public static void ValidateWorkflow(Workflow state)
        {
            RequireList(state.SuggestedRules, false);
            if (state.EarlyTasks == null || state.EarlyTasks.Count > 2 || state.EarlyTasks.Any(item => item == null || item.Task == null || item.Task.Id != (item.Task.Role == "Development" ? "development-requirements" : item.Task.Role == "QA" ? "qa-requirements" : "") || item.Created != null && item.Created.Id != item.Task.Id) || state.EarlyTasks.Select(item => item.Task.Id).Distinct().Count() != state.EarlyTasks.Count)
            {
                throw new JsonException("Invalid early task publication identity.");
            }

            if ((state.ArtCreated != null || state.ArtPending) && state.ArtTask == null || state.ArtTask != null && (state.ArtTask.Id != "art-requirements" || state.ArtTask.Role != "Art") || state.ArtCreated != null && state.ArtCreated.Id != state.ArtTask!.Id)
            {
                throw new JsonException("Invalid early art publication identity.");
            }

            if (!Guid.TryParseExact(state.Id, "N", out _) || state.Created == null || state.Executions == null || state.Created.Any(item => item == null || string.IsNullOrWhiteSpace(item.Id) || string.IsNullOrWhiteSpace(item.Key)) || state.Executions.Any(item => item == null) || state.Created.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() != state.Created.Count)
            {
                throw new JsonException("Invalid persisted workflow identity or execution/task records.");
            }

            if (state.Stage is not ("design_pending" or "design_running" or "design_failed" or "needs_clarification" or "awaiting_approval" or "pm_pending" or "pm_running" or "publishing" or "pm_failed" or "outcome_unknown" or "tasks_created"))
            {
                throw new JsonException("Unknown workflow stage.");
            }

            if (state.Design != null)
            {
                ValidateDesign(state.Design);
            }

            if (state.Plan != null)
            {
                if (state.Design == null)
                {
                    throw new JsonException("Task plan has no source design.");
                }

                ValidatePlan(state.Plan, state.Design);
                HashSet<string> ids = state.Plan.Tasks.Select(task => task.Id).ToHashSet(StringComparer.Ordinal);
                if (state.Created.Any(item => !ids.Contains(item.Id)) || state.PendingTask != null && !ids.Contains(state.PendingTask))
                {
                    throw new JsonException("Published task record is not part of the saved plan.");
                }
            }
            else if (state.Created.Count > 0 || state.PendingTask != null)
            {
                throw new JsonException("Published task records require a saved plan.");
            }
        }

        public static void ValidatePlan(TaskPlan plan, DesignBrief design)
        {
            if (plan.Tasks == null || plan.Tasks.Length is < 2 or > 20 || plan.Tasks.Any(task => task == null))
            {
                throw new JsonException("PM must return 2 to 20 tasks.");
            }

            HashSet<string> ids = new(StringComparer.Ordinal);
            foreach (PlannedTask task in plan.Tasks)
            {
                if (task.Id == null || !Regex.IsMatch(task.Id, "^[a-zA-Z0-9_-]{1,40}$") || !ids.Add(task.Id) || task.Role is not ("Art" or "Development" or "QA"))
                {
                    throw new JsonException("Invalid role or duplicate/invalid task ID.");
                }

                RequireText(task.Title, 200);
                RequireText(task.Description, 6000);
                RequireList(task.Acceptance, true);
                RequireList(task.DependsOn, false);
            }

            if (!plan.Tasks.Any(task => task.Role == "Development") || !plan.Tasks.Any(task => task.Role == "QA") || design.ArtRequirements.Length > 0 && !plan.Tasks.Any(task => task.Role == "Art"))
            {
                throw new JsonException("PM must cover Development, QA, and requested Art work.");
            }

            HashSet<string> resolved = new(StringComparer.Ordinal);
            while (resolved.Count < ids.Count)
            {
                int before = resolved.Count;
                foreach (PlannedTask task in plan.Tasks)
                {
                    if (task.DependsOn.Any(dependency => !ids.Contains(dependency)))
                    {
                        throw new JsonException("Task dependency does not exist.");
                    }

                    if (task.DependsOn.All(resolved.Contains))
                    {
                        resolved.Add(task.Id);
                    }
                }

                if (before == resolved.Count)
                {
                    throw new JsonException("Task dependency cycle detected.");
                }
            }

            if (plan.Tasks.Any(task => task.Role == "QA" && task.DependsOn.Length == 0))
            {
                throw new JsonException("QA tasks must depend on the work being tested.");
            }
        }

        public static void RequireText(string? value, int maximum)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length > maximum)
            {
                throw new JsonException("Required text is empty or exceeds " + maximum + " characters.");
            }
        }

        private static void RequireList(string[]? values, bool required)
        {
            if (values == null || values.Length > 30 || required && values.Length == 0)
            {
                throw new JsonException("Invalid or missing list.");
            }

            foreach (string value in values)
            {
                RequireText(value, 1000);
            }
        }
    }
}
