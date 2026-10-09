using GameCLI.Abstractions;

namespace GameCLI.Plugins
{
    /// <summary>
    /// Supplies the in-memory enablement state shared by compiled-in CLI plugins.
    /// </summary>
    public abstract class CLIPlugin : ICLIPlugin
    {
        /// <inheritdoc />
        public abstract string Id
        { get; }

        /// <inheritdoc />
        public abstract string Description
        { get; }

        /// <inheritdoc />
        public bool IsEnabled
        { get; private set; } = true;

        /// <inheritdoc />
        public abstract IReadOnlyList<ICommand> Commands
        { get; }

        /// <inheritdoc />
        public void Enable()
        {
            IsEnabled = true;
        }

        /// <inheritdoc />
        public void Disable()
        {
            IsEnabled = false;
        }
    }
}
