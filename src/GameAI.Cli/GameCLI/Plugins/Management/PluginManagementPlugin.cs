using System.Text.Json;

using GameCLI.Abstractions;
using GameCLI.Core;

namespace GameCLI.Plugins.Management
{
    internal sealed class PluginManagementPlugin : CLIPlugin
    {
        /// <inheritdoc />
        public override string Id => "plugins";

        /// <inheritdoc />
        public override string Description => "List, enable and disable CLI plugins.";

        /// <inheritdoc />
        public override IReadOnlyList<ICommand> Commands
        { get; }

        /// <summary>
        /// Registers management commands against the supplied host without changing preferences.
        /// </summary>
        public PluginManagementPlugin(PluginHost host)
        {
            Commands = Array.AsReadOnly<ICommand>(new ICommand[]
            {
                new PluginManagementCommand(host, "list"),
                new PluginManagementCommand(host, "enable"),
                new PluginManagementCommand(host, "disable")
            });
        }
    }

    internal sealed class PluginManagementCommand : ICommand
    {
        private readonly PluginHost host;

        /// <inheritdoc />
        public string Name
        { get; }

        /// <inheritdoc />
        public string Description => Name + " CLI plugins";

        /// <summary>
        /// Binds a management operation to the host whose plugin preferences it controls.
        /// </summary>
        public PluginManagementCommand(PluginHost host, string name)
        {
            this.host = host;
            Name = name;
        }

        /// <inheritdoc />
        public Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine("GameCLI plugins " + Name + (Name == "list" ? "" : " <plugin>") + " [--format human|json]");
                return Task.FromResult(0);
            }

            int expected = Name == "list" ? 0 : 1;
            bool json = false;
            if (args.Length == expected + 2 && args[expected] == "--format" && args[expected + 1] is "human" or "json")
            {
                json = args[expected + 1] == "json";
            }
            else if (args.Length != expected)
            {
                throw new ArgumentException("Use GameCLI plugins " + Name + " --help.");
            }

            if (Name != "list")
            {
                host.SetEnabled(args[0], Name == "enable");
            }

            var entries = host.Plugins.Select(plugin => new
            {
                id = plugin.Id,
                enabled = plugin.IsEnabled,
                description = plugin.Description,
                commands = plugin.Commands.Select(command => command.Name).ToArray()
            }).ToArray();
            if (json)
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    ok = true,
                    plugins = entries
                }));
            }
            else
            {
                foreach (var entry in entries)
                {
                    Console.WriteLine($"{entry.id}: {(entry.enabled ? "enabled" : "disabled")} | {entry.commands.Length} commands");
                }
            }

            return Task.FromResult(0);
        }
    }
}
