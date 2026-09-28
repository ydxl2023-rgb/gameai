using GameCLI.Abstractions;

namespace GameCLI.Plugins.Design
{
    /// <summary>Provides single-role Design execution and cloud requirement submission.</summary>
    public sealed class DesignPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "design";

        /// <inheritdoc />
        public override string Description => "Design document generation and review submission";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new DesignDocumentCommand(),
            new DesignDocumentCommand(submitOnly: true)
        });
    }
}
