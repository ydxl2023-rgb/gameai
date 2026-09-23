using GameCLI.Abstractions;

namespace GameCLI.Plugins.QA
{
    /// <summary>
    /// Reserves the quality-assurance capability group; it currently registers no commands.
    /// </summary>
    public sealed class QAPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "qa";

        /// <inheritdoc />
        public override string Description => "Quality assurance (commands not implemented)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[] {});
    }
}
