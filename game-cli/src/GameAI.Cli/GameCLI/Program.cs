using GameCLI.Abstractions;
using GameCLI.Core;
using GameCLI.Plugins.Art;
using GameCLI.Plugins.Development;
using GameCLI.Plugins.Design;
using GameCLI.Plugins.PM;
using GameCLI.Plugins.QA;
using GameCLI.Services;

namespace GameCLI
{
    internal static class Program
    {
        private static Task<int> Main(string[] args)
        {
            // The server decodes redirected stdout and stderr as UTF-8 on every host.
            Console.InputEncoding = new System.Text.UTF8Encoding(false);
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            ICLIPlugin[] plugins =
            {
                new DesignPlugin(),
                new PMPlugin(),
                new ArtPlugin(),
                new DevelopmentPlugin(),
                new GameCLI.Plugins.Prefab.PrefabPlugin(),
                new QAPlugin(),
                new GameCLI.Plugins.UiLibrary.UiLibraryPlugin()
            };
            PluginHost host = new(plugins, new PluginSettingsStore());
            return host.RunAsync(args);
        }
    }
}
