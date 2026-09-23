using GameCLI.Abstractions;

namespace GameCLI.Plugins.Art
{
    public sealed class ArtPlugin : CLIPlugin
    {
        public override string Id => "art";
        public override string Description => "Art production (commands not implemented)";
        public override IReadOnlyList<ICommand> Commands { get; } = Array.AsReadOnly(new ICommand[] {  });
    }
}

