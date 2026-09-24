using System.Text.Json;

namespace GameCLI.Contracts
{
    internal sealed record DeliveryArtifact(string Path, string Sha256, string Purpose);

    internal sealed record DeliveryCheck(string Name, bool Passed, string EvidencePath);

    internal sealed record DeliveryResult(string Verdict, string Summary, DeliveryArtifact[] Artifacts, DeliveryCheck[] Checks);

    /// <summary>Stored on the professional JIRA subtask, independently of the requirement snapshot.</summary>
    internal sealed class TaskDelivery
    {
        public int SchemaVersion
        { get; set; } = 1;

        public string WorkflowId
        { get; set; } = "";

        public string IssueKey
        { get; set; } = "";

        public string Revision
        { get; set; } = "";

        public string TaskHash
        { get; set; } = "";

        public string ExecutionId
        { get; set; } = "";

        public string ThreadId
        { get; set; } = "";

        public string TurnId
        { get; set; } = "";

        public string Status
        { get; set; } = "running";

        public int Attempts
        { get; set; }

        public Dictionary<string, string> DependencyVersions
        { get; set; } = new();

        public DeliveryResult? Result
        { get; set; }

        public string FailureSummary
        { get; set; } = "执行未通过，请核对代理会话。";

        public string Version
        { get; set; } = "";

        public DateTimeOffset StartedAt
        { get; set; }

        public DateTimeOffset? SubmittedAt
        { get; set; }

        public bool CompletionRequested
        { get; set; }

        public static object ResultSchema => WorkflowContract.ObjectSchema(new()
        {
            ["verdict"] = new
            {
                type = "string",
                @enum = new[]
                {
                    "pass",
                    "fail",
                    "blocked"
                }
            },
            ["summary"] = WorkflowContract.Text,
            ["artifacts"] = new
            {
                type = "array",
                items = WorkflowContract.ObjectSchema(new()
                {
                    ["path"] = WorkflowContract.Text,
                    ["sha256"] = WorkflowContract.Text,
                    ["purpose"] = WorkflowContract.Text
                })
            },
            ["checks"] = new
            {
                type = "array",
                items = WorkflowContract.ObjectSchema(new()
                {
                    ["name"] = WorkflowContract.Text,
                    ["passed"] = new
                    {
                        type = "boolean"
                    },
                    ["evidence_path"] = WorkflowContract.Text
                })
            }
        });

        /// <summary>Includes execution identity so a new submission always invalidates downstream inputs.</summary>
        public string ComputeVersion()
        {
            return WorkflowContract.Hash(WorkflowContract.Serialize(new
            {
                WorkflowId,
                IssueKey,
                Revision,
                TaskHash,
                ExecutionId,
                dependencies = DependencyVersions.OrderBy(item => item.Key, StringComparer.Ordinal).ToArray(),
                Result
            }));
        }

        /// <summary>Rejects invalid execution identities and inconsistent submitted versions.</summary>
        public void Validate()
        {
            if (SchemaVersion != 1 || !Guid.TryParseExact(ExecutionId, "N", out _) || Attempts is < 1 or > 3 || DependencyVersions == null || DependencyVersions.Count > 20 || Status is not ("running" or "submitted" or "failed"))
            {
                throw new JsonException("无效的任务交付记录。");
            }

            if (Status == "submitted" && (Result == null || SubmittedAt == null || Version != ComputeVersion()))
            {
                throw new JsonException("交付版本缺失或已被修改。");
            }
        }
    }

    internal sealed record TaskGate(string TaskId, string IssueKey, string Role, string State, string Reason, string[] DependsOn, TaskDelivery? Delivery);

    internal sealed record GateReport(string IssueKey, string Revision, bool Approved, bool Complete, TaskGate[] Tasks);

    internal sealed record JiraTaskState(bool Done, DateTimeOffset UpdatedAt);
}
