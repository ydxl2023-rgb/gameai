using GameCLI.Abstractions;

namespace GameCLI.Plugins.Jira
{
    /// <summary>
    /// Reserves the JIRA CLI group; connection configuration currently lives in the Editor UI.
    /// </summary>
    public sealed class JiraPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "jira";

        /// <inheritdoc />
        public override string Description => "JIRA integration (CLI commands not implemented)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[] {});
    }
}
