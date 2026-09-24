using GameCLI.Abstractions;

namespace GameCLI.Plugins.Orchestrator
{
    /// <summary>
    /// Coordinates document analysis, versioned approval and JIRA task publication.
    /// </summary>
    public sealed class OrchestratorPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "orchestrator";

        /// <inheritdoc />
        public override string Description => "Design and PM workflow orchestration";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new WorkflowCommand("start"),
            new WorkflowCommand("status"),
            new WorkflowCommand("approve"),
            new WorkflowCommand("resume"),
            new WorkflowCommand("revise"),
            new WorkflowCommand("gates"),
            new WorkflowCommand("dispatch"),
            new WorkflowCommand("art-probe"),
            new WorkflowCommand("development-probe"),
            new WorkflowCommand("watch"),
            new ConnectCommand()
        });
    }
}
