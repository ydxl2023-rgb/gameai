using GameCLI.Abstractions;

namespace GameCLI.Plugins.Orchestrator
{
    public sealed class OrchestratorPlugin : CLIPlugin
    {
        public override string Id => "orchestrator";
        public override string Description => "Workflow orchestration (CLI commands not implemented)";
        public override IReadOnlyList<ICommand> Commands { get; } = Array.AsReadOnly(new ICommand[] {  });
    }
}

