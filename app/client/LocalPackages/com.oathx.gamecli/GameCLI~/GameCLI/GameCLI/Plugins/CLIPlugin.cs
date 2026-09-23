using GameCLI.Abstractions;

namespace GameCLI.Plugins
{
    public abstract class CLIPlugin : ICLIPlugin
    {
        public abstract string Id { get; }
        public abstract string Description { get; }
        public bool IsEnabled { get; private set; } = true;
        public abstract IReadOnlyList<ICommand> Commands { get; }

        public void Enable()
        {
            IsEnabled = true;
        }

        public void Disable()
        {
            IsEnabled = false;
        }
    }
}
