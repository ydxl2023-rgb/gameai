namespace GameCLI.Abstractions
{
    /// <summary>
    /// Groups commands behind a shared enablement gate managed by the CLI host.
    /// </summary>
    public interface ICLIPlugin
    {
        /// <summary>Gets the stable lowercase identifier, unique within the host.</summary>
        public string Id
        { get; }

        /// <summary>Gets the human-readable capability description.</summary>
        public string Description
        { get; }

        /// <summary>Gets whether the host may dispatch new commands to this plugin.</summary>
        public bool IsEnabled
        { get; }

        /// <summary>Gets the registered commands; names must be unique within the plugin.</summary>
        public IReadOnlyList<ICommand> Commands
        { get; }

        /// <summary>Allows future dispatch without starting commands or persisting preferences.</summary>
        public void Enable();

        /// <summary>Rejects future dispatch without cancelling commands already in progress.</summary>
        public void Disable();
    }
}
