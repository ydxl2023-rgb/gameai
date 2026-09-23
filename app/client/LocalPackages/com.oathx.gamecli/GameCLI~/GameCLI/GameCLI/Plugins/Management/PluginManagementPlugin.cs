using System.Text.Json;
using GameCLI.Abstractions;
using GameCLI.Core;

namespace GameCLI.Plugins.Management
{
    internal sealed class PluginManagementPlugin : CLIPlugin
    {
        public override string Id => "plugins";
        public override string Description => "List, enable and disable CLI plugins.";
        public override IReadOnlyList<ICommand> Commands { get; }

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
        public string Name { get; }
        public string Description => Name + " CLI plugins";

        public PluginManagementCommand(PluginHost host, string name)
        {
            this.host = host;
            Name = name;
        }

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
                id = plugin.Id, enabled = plugin.IsEnabled, description = plugin.Description,
                commands = plugin.Commands.Select(command => command.Name).ToArray()
            }).ToArray();
            if (json)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { ok = true, plugins = entries }));
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
