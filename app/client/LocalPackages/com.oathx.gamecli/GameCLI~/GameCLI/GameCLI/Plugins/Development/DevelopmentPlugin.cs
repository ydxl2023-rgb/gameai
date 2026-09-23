using GameCLI.Abstractions;

namespace GameCLI.Plugins.Development
{
    public sealed class DevelopmentPlugin : CLIPlugin
    {
        public override string Id => "development";
        public override string Description => "Development agent (commands not implemented)";
        public override IReadOnlyList<ICommand> Commands { get; } = Array.AsReadOnly(new ICommand[] {  });
    }
}

