using GameCLI.Abstractions;

namespace GameCLI.Plugins.PM
{
    /// <summary>
    /// Registers read-only PM analysis through the Codex runner.
    /// </summary>
    public sealed class PMPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "pm";

        /// <inheritdoc />
        public override string Description => "PM requirement analysis";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new PmAnalyzeCommand()
        });
    }
}
