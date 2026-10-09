namespace GameCLI.Abstractions
{
    /// <summary>
    /// Defines one CLI operation whose arguments exclude the plugin and command names.
    /// </summary>
    public interface ICommand
    {
        /// <summary>Gets the stable lowercase command name used for dispatch.</summary>
        public string Name
        { get; }

        /// <summary>Gets the human-readable description shown in command help.</summary>
        public string Description
        { get; }

        /// <summary>Executes a command after the host has checked plugin enablement.</summary>
        /// <param name="args">Command options without the plugin or operation name.</param>
        /// <param name="cancellationToken">Cancellation propagated to command-owned operations.</param>
        /// <returns>The CLI exit code: 0 success, 1 retryable failure, 2 repair required, 3 blocked, 4 invalid input, or 5 configuration failure.</returns>
        /// <remarks>Commands own output formatting; JSON mode reserves stdout for structured results and sends diagnostics to stderr. Implementations define whether cancellation is mapped to an exit code or propagated to the host.</remarks>
        public Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken);
    }
}
