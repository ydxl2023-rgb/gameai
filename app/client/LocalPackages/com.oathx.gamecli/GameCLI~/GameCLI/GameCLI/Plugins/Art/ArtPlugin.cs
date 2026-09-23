using GameCLI.Abstractions;

namespace GameCLI.Plugins.Art
{
    /// <summary>
    /// Reserves the art capability group; it currently registers no commands.
    /// </summary>
    public sealed class ArtPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "art";

        /// <inheritdoc />
        public override string Description => "Art production (commands not implemented)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[] {});
    }
}
