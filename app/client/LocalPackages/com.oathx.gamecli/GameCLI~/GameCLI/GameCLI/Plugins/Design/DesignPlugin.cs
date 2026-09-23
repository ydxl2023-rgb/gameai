using GameCLI.Abstractions;

namespace GameCLI.Plugins.Design
{
    /// <summary>Identifies the Design role; Orchestrator currently owns its execution commands.</summary>
    public sealed class DesignPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "design";

        /// <inheritdoc />
        public override string Description => "Game design analysis (invoked through orchestrator)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[] {});
    }
}
