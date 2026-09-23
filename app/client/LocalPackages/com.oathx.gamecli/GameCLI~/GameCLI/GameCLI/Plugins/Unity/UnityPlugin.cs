using GameCLI.Abstractions;

namespace GameCLI.Plugins.Unity
{
    public sealed class UnityPlugin : CLIPlugin
    {
        public override string Id => "unity";
        public override string Description => "Unity Editor integration";
        public override IReadOnlyList<ICommand> Commands { get; } = Array.AsReadOnly(new ICommand[] { new UnityPingCommand() });
    }
}

