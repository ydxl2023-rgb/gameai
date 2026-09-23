using GameCLI.Abstractions;

namespace GameCLI.Plugins.Jira
{
    /// <summary>
    /// Registers JIRA operations using the connection configured in the Editor UI.
    /// </summary>
    public sealed class JiraPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "jira";

        /// <inheritdoc />
        public override string Description => "Create JIRA tasks using saved connection settings.";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new JiraCreateCommand()
        });
    }
}
