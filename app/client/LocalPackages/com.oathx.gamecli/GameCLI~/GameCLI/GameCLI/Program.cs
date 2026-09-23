using GameCLI.Abstractions;
using GameCLI.Core;
using GameCLI.Plugins.Art;
using GameCLI.Plugins.Development;
using GameCLI.Plugins.Jira;
using GameCLI.Plugins.Orchestrator;
using GameCLI.Plugins.PM;
using GameCLI.Plugins.QA;
using GameCLI.Plugins.Unity;
using GameCLI.Services;

namespace GameCLI
{
    internal static class Program
    {
        private static Task<int> Main(string[] args)
        {
            ICLIPlugin[] plugins =
            {
                new OrchestratorPlugin(), new PMPlugin(), new ArtPlugin(), new DevelopmentPlugin(),
                new UnityPlugin(), new QAPlugin(), new JiraPlugin()
            };
            PluginHost host = new(plugins, new PluginSettingsStore());
            return host.RunAsync(args);
        }
    }
}
