using GameCLI.Abstractions;

namespace GameCLI.Plugins.Tasks
{
    /// <summary>Typed UI task planning through the authoritative server adapter.</summary>
    public sealed class TaskPlugin : CLIPlugin
    {
        public override string Id => "task";

        public override string Description => "Validate production contracts and atomically submit UI task plans";

        public override IReadOnlyList<ICommand> Commands
        { get; } = Array.AsReadOnly(new ICommand[]
        {
            new TaskCommand("contract"),
            new TaskCommand("plan")
        });
    }
}
