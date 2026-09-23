using GameCLI.Abstractions;

namespace GameCLI.Plugins.Unity
{
    /// <summary>
    /// Registers commands that communicate with the Unity Editor bridge.
    /// </summary>
    public sealed class UnityPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "unity";

        /// <inheritdoc />
        public override string Description => "Unity Editor integration";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new UnityPingCommand()
        });
    }
}
