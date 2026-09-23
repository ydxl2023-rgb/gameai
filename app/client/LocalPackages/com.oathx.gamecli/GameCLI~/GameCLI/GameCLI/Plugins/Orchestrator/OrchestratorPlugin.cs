using GameCLI.Abstractions;

namespace GameCLI.Plugins.Orchestrator
{
    /// <summary>
    /// Reserves the orchestration capability group; it currently registers no commands.
    /// </summary>
    public sealed class OrchestratorPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "orchestrator";

        /// <inheritdoc />
        public override string Description => "Workflow orchestration (CLI commands not implemented)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[] {});
    }
}
