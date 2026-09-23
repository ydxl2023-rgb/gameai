using GameCLI.Abstractions;

namespace GameCLI.Plugins.PM
{
    public sealed class PMPlugin : CLIPlugin
    {
        public override string Id => "pm";
        public override string Description => "PM requirement analysis";
        public override IReadOnlyList<ICommand> Commands { get; } = Array.AsReadOnly(new ICommand[] { new PmAnalyzeCommand() });
    }
}

