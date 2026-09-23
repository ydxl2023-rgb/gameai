namespace GameCLI.Contracts
{
    /// <summary>Records a read-only agent smoke test separately from production deliveries.</summary>
    internal sealed record ArtProbe(string WorkflowId, string Revision, string IssueKey, string ExecutionId, string Status, string ThreadId, string TurnId, DateTimeOffset StartedAt, ArtProbeResult? Result);

    internal sealed record ArtProbeResult(string IssueKey, string ExecutionId, bool Acknowledged, bool AssetsGenerated, string Summary, string[] PlannedOutputs);
}
