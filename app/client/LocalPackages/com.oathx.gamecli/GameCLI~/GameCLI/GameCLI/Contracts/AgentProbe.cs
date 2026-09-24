namespace GameCLI.Contracts
{
    /// <summary>Records a read-only agent smoke test separately from production deliveries.</summary>
    internal sealed record AgentProbe(string WorkflowId, string Revision, string IssueKey, string ExecutionId, string Status, string ThreadId, string TurnId, DateTimeOffset StartedAt, AgentProbeResult? Result, string Role = "Art", string? FailureSummary = null);

    internal sealed record AgentProbeResult(string IssueKey, string ExecutionId, bool Acknowledged, bool AssetsGenerated, string Summary, string[] PlannedOutputs);
}
