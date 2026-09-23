using GameCLI.Abstractions;

namespace GameCLI.Plugins.Development
{
    /// <summary>
    /// Reserves the development capability group; it currently registers no commands.
    /// </summary>
    public sealed class DevelopmentPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "development";

        /// <inheritdoc />
        public override string Description => "Development agent (commands not implemented)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[] {});
    }
}
