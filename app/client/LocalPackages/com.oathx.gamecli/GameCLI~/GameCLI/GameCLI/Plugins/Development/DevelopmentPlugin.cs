using GameCLI.Abstractions;
using GameCLI.Agents;

namespace GameCLI.Plugins.Development
{
    /// <summary>
    /// Registers read-only analysis through the fixed role Agent.
    /// </summary>
    public sealed class DevelopmentPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "development";

        /// <inheritdoc />
        public override string Description => "Development agent (fixed Agent analysis)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new SpecialistAnalyzeCommand("Development"),
            new SpecialistExecuteCommand("Development")
        });
    }
}
