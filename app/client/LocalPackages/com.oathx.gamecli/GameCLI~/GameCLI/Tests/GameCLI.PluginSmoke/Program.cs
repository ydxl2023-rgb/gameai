using System.Diagnostics;
using GameCLI.Abstractions;
using GameCLI.Core;
using GameCLI.Plugins;
using GameCLI.Plugins.Art;
using GameCLI.Services;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "child")
        {
            return await Create(args[1]).RunAsync(new[] { "probe", "--check", "--format", "json" });
        }

        string folder = Path.Combine(Path.GetTempPath(), "gamecli-plugin-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        string path = Path.Combine(folder, "plugins.json");
        try
        {
            PluginHost host = Create(path);
            Require(await host.RunAsync(new[] { "probe", "--check" }) == 0 && ProbeCommand.Calls == 1, "initial dispatch");
            Require(await host.RunAsync(new[] { "plugins", "disable", "probe" }) == 0, "disable");
            Require(await host.RunAsync(new[] { "probe", "check" }) == 3 && ProbeCommand.Calls == 1, "disabled commands do not execute");
            ProcessStartInfo info = new(Environment.ProcessPath ?? throw new Exception("No executable")) { UseShellExecute = false };
            foreach (string argument in new[] { "child", path })
            {
                info.ArgumentList.Add(argument);
            }

            using Process child = Process.Start(info) ?? throw new Exception("Cannot launch child");
            await child.WaitForExitAsync();
            Require(child.ExitCode == 3, "disabled state survives new process");
            Require(await host.RunAsync(new[] { "plugins", "enable", "probe" }) == 0, "enable");
            Require(await host.RunAsync(new[] { "probe", "check" }) == 0 && ProbeCommand.Calls == 2, "enabled dispatch");
            Require(await host.RunAsync(new[] { "plugins", "disable", "plugins" }) == 4, "management protected");
            Require(await host.RunAsync(new[] { "plugins", "disable", "unknown" }) == 4, "unknown plugin rejected");
            Require(await host.RunAsync(new[] { "art", "--generate" }) == 4, "empty plugin cannot fake success");
            Require(await host.RunAsync(new[] { "plugins", "disable", "probe", "--bad" }) == 4 && new PluginSettingsStore(path).Read()["probe"], "invalid options have no side effects");
            await Task.WhenAll(Task.Run(() => new PluginSettingsStore(path).SetEnabled("art", false)),
                Task.Run(() => new PluginSettingsStore(path).SetEnabled("probe", false)));
            var preferences = new PluginSettingsStore(path).Read();
            Require(!preferences["art"] && !preferences["probe"], "concurrent updates retained");
            try
            {
                _ = new PluginHost(new ICLIPlugin[] { new ProbePlugin(), new ProbePlugin() }, new PluginSettingsStore(path));
                throw new Exception("Duplicate plugin accepted");
            }
            catch (ArgumentException)
            {
                Console.WriteLine("PASS duplicate plugin rejected");
            }

            File.WriteAllText(path, "invalid");
            Require(await host.RunAsync(new[] { "probe", "check" }) == 5 && ProbeCommand.Calls == 2, "corrupt preferences fail closed");
            Console.WriteLine("PLUGIN_SMOKE_PASSED");
            return 0;
        }
        finally
        {
            File.Delete(path);
            Directory.Delete(folder);
        }
    }

    private static PluginHost Create(string path)
    {
        return new PluginHost(new ICLIPlugin[] { new ProbePlugin(), new ArtPlugin() }, new PluginSettingsStore(path));
    }

    private static void Require(bool condition, string name)
    {
        if (!condition)
        {
            throw new Exception(name);
        }

        Console.WriteLine("PASS " + name);
    }

    private sealed class ProbePlugin : CLIPlugin
    {
        public override string Id => "probe";
        public override string Description => "Test plugin";
        public override IReadOnlyList<ICommand> Commands { get; } = new ICommand[] { new ProbeCommand() };
    }

    private sealed class ProbeCommand : ICommand
    {
        public static int Calls;
        public string Name => "check";
        public string Description => "Track invocation";
        public Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(0);
        }
    }
}
