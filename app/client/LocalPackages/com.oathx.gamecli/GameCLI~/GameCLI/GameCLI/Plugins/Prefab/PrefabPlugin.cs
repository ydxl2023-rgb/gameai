using GameCLI.Abstractions;
using GameCLI.Agents;

namespace GameCLI.Plugins.Prefab
{
    /// <summary>
    /// Registers read-only analysis through the fixed role Agent.
    /// </summary>
    public sealed class PrefabPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "prefab";

        /// <inheritdoc />
        public override string Description => "Prefab agent (fixed Agent analysis)";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new SpecialistAnalyzeCommand("Prefab"),
            new SpecialistExecuteCommand("Prefab")
        });
    }
}
