using System.Text.Json;

using GameCLI.Abstractions;
using GameCLI.Plugins.Management;
using GameCLI.Services;

namespace GameCLI.Core
{
    /// <summary>
    /// Registers plugins, applies persisted enablement, and dispatches command operations.
    /// </summary>
    public sealed class PluginHost
    {
        private readonly Dictionary<string, ICLIPlugin> plugins = new(StringComparer.Ordinal);

        private readonly PluginSettingsStore settings;

        /// <summary>Gets a snapshot of registered plugin references, including the protected management plugin.</summary>
        public IReadOnlyCollection<ICLIPlugin> Plugins => plugins.Values.ToArray();

        /// <summary>Registers the supplied plugins and the built-in management commands.</summary>
        /// <exception cref="ArgumentException">A plugin or command identifier is invalid or duplicated.</exception>
        public PluginHost(IEnumerable<ICLIPlugin> plugins, PluginSettingsStore settings)
        {
            this.settings = settings;
            foreach (ICLIPlugin plugin in plugins)
            {
                Register(plugin);
            }

            Register(new PluginManagementPlugin(this));
        }

        private void Register(ICLIPlugin plugin)
        {
            if (!IsValidName(plugin.Id) || !plugins.TryAdd(plugin.Id, plugin))
            {
                throw new ArgumentException("Invalid or duplicate plugin ID: " + plugin.Id);
            }

            HashSet<string> names = new(StringComparer.Ordinal);
            foreach (ICommand command in plugin.Commands)
            {
                if (!IsValidName(command.Name) || !names.Add(command.Name))
                {
                    throw new ArgumentException("Invalid or duplicate command in " + plugin.Id);
                }
            }
        }

        private static bool IsValidName(string name)
        {
            return !string.IsNullOrEmpty(name) && char.IsAsciiLetterLower(name[0]) && name.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '-');
        }

        /// <summary>Persists enablement before updating the registered plugin's in-memory state.</summary>
        /// <exception cref="ArgumentException">The plugin is unknown or is the protected management plugin.</exception>
        public void SetEnabled(string id, bool enabled)
        {
            if (id == "plugins" || !plugins.TryGetValue(id, out ICLIPlugin? plugin))
            {
                throw new ArgumentException("Unknown plugin or protected management plugin: " + id);
            }

            settings.SetEnabled(id, enabled);
            if (enabled)
            {
                plugin.Enable();
            }
            else
            {
                plugin.Disable();
            }
        }

        /// <summary>Reloads preferences and dispatches one command after checking its plugin gate.</summary>
        /// <returns>The command exit code, or a mapped input, configuration, or cancellation failure.</returns>
        /// <remarks>Enablement is checked before command parsing or command side effects. Cancellation does not disable the plugin.</remarks>
        public async Task<int> RunAsync(string[] args, CancellationToken cancellationToken = default)
        {
            try
            {
                Dictionary<string, bool> preferences = settings.Read();
                foreach (ICLIPlugin plugin in plugins.Values)
                {
                    if (plugin.Id == "plugins" || preferences.GetValueOrDefault(plugin.Id, true))
                    {
                        plugin.Enable();
                    }
                    else
                    {
                        plugin.Disable();
                    }
                }

                if (args.Length == 0 || args.Length == 1 && args[0] is "--help" or "-h")
                {
                    Console.WriteLine("GameCLI <plugin> <command> [options] (also accepts --command)");
                    foreach (ICLIPlugin plugin in plugins.Values)
                    {
                        Console.WriteLine($"  {plugin.Id}: {(plugin.IsEnabled ? "enabled" : "disabled")} | {plugin.Commands.Count} commands | {plugin.Description}");
                    }

                    return 0;
                }

                if (!plugins.TryGetValue(args[0], out ICLIPlugin? selected))
                {
                    return Fail(args, 4, "Unknown plugin: " + args[0]);
                }

                if (args.Length == 1 || args.Length == 2 && args[1] is "--help" or "-h")
                {
                    Console.WriteLine(selected.Id + ": " + selected.Description + " | " + (selected.IsEnabled ? "enabled" : "disabled"));
                    foreach (ICommand command in selected.Commands)
                    {
                        Console.WriteLine("  --" + command.Name + "  " + command.Description);
                    }

                    return 0;
                }

                // Enforce the plugin gate before command parsing or any side effects.
                if (!selected.IsEnabled)
                {
                    return Fail(args, 3, "Plugin is disabled: " + selected.Id + ". Use GameCLI plugins enable " + selected.Id);
                }

                string operation = args[1].StartsWith("--", StringComparison.Ordinal) ? args[1][2..] : args[1];
                ICommand? handler = selected.Commands.SingleOrDefault(command => command.Name == operation);
                if (handler == null)
                {
                    return Fail(args, 4, selected.Commands.Count == 0 ? "No implemented CLI commands in plugin: " + selected.Id : "Unknown command: " + operation);
                }

                cancellationToken.ThrowIfCancellationRequested();
                return await handler.ExecuteAsync(args[2..], cancellationToken);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or ArgumentException or OperationCanceledException)
            {
                int code = exception is ArgumentException ? 4 : exception is OperationCanceledException ? 3 : 5;
                return Fail(args, code, exception is JsonException ? "Invalid plugin settings. Repair ~/.gamecli/plugins.json." : exception.Message);
            }
        }

        private static int Fail(string[] args, int code, string message)
        {
            if (args.Zip(args.Skip(1)).Any(pair => pair.First == "--format" && pair.Second == "json"))
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    ok = false,
                    exit_code = code,
                    message
                }));
            }

            Console.Error.WriteLine(message);
            return code;
        }
    }
}
