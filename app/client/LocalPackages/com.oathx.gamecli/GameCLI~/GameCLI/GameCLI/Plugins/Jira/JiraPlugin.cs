using GameCLI.Abstractions;

namespace GameCLI.Plugins.Jira
{
    public sealed class JiraPlugin : CLIPlugin
    {
        public override string Id => "jira";
        public override string Description => "JIRA integration (CLI commands not implemented)";
        public override IReadOnlyList<ICommand> Commands { get; } = Array.AsReadOnly(new ICommand[] {  });
    }
}

