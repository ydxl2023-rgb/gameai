using GameCLI.Abstractions;
using GameCLI.Agents;

namespace GameCLI.Plugins.Art
{
    /// <summary>
    /// Registers read-only analysis through the fixed role Agent.
    /// </summary>
    public sealed class ArtPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "art";

        /// <inheritdoc />
        public override string Description => "Art production (fixed Agent analysis)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new SpecialistAnalyzeCommand("Art"),
            new SpecialistExecuteCommand("Art")
        });
    }
}
