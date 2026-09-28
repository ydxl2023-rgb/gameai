using GameCLI.Abstractions;
using GameCLI.Core;
using GameCLI.Plugins.Art;
using GameCLI.Plugins.Development;
using GameCLI.Plugins.Design;
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
                new DesignPlugin(),
                new PMPlugin(),
                new ArtPlugin(),
                new DevelopmentPlugin(),
                new UnityPlugin(),
                new QAPlugin()
            };
            PluginHost host = new(plugins, new PluginSettingsStore());
            return host.RunAsync(args);
        }
    }
}
