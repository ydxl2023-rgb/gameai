using GameCLI.Abstractions;

namespace GameCLI.Plugins.QA
{
    public sealed class QAPlugin : CLIPlugin
    {
        public override string Id => "qa";
        public override string Description => "Quality assurance (commands not implemented)";
        public override IReadOnlyList<ICommand> Commands { get; } = Array.AsReadOnly(new ICommand[] {  });
    }
}

