using GameCLI.Abstractions;
using GameCLI.Agents;

namespace GameCLI.Plugins.QA
{
    /// <summary>
    /// Registers read-only analysis through the fixed role Agent.
    /// </summary>
    public sealed class QAPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "qa";

        /// <inheritdoc />
        public override string Description => "Quality assurance (fixed Agent analysis)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new SpecialistAnalyzeCommand("QA"),
            new SpecialistExecuteCommand("QA")
        });
    }
}
