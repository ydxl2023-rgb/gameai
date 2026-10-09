# CLI plugin architecture

The .NET CLI uses registered feature modules. Every plugin implements `ICLIPlugin` (built-ins inherit `CLIPlugin`); every executable command implements `ICommand`. `Program` is the composition root and registers plugins. `PluginHost` validates IDs, applies configuration, selects commands and checks enablement before executing any command. It has no feature-specific dispatch switch.

```text
GameCLI/
  Abstractions/
    ICommand.cs             Name, Description, ExecuteAsync(args, cancellationToken)
    ICLIPlugin.cs           Id, Description, Commands, IsEnabled, Enable, Disable
  Core/PluginHost.cs        Registry, help, dispatch and enablement gate
  Plugins/
    CLIPlugin.cs            Common plugin lifecycle
    Design/                 DesignPlugin (reserved role)
    PM/                     PMPlugin, PmAnalyzeCommand
    Unity/                  UnityPlugin, UnityPingCommand
    Art/                    ArtPlugin
    Development/            DevelopmentPlugin
    QA/                     QAPlugin
    Management/             Plugin management and ICommand implementations
  Agents/                   Agent execution services
  Contracts/                Validated result contracts
  Services/                 Codex, Unity transport and plugin settings
```

## Commands

```powershell
GameCLI.exe plugins list --format json
GameCLI.exe plugins disable pm
GameCLI.exe plugins enable pm
GameCLI.exe unity --ping --project <Unity project> --format json
GameCLI.exe pm --analyze --project <project> --prompt "Requirement" --format json
```

Both `--command` and `command` are accepted immediately after the plugin ID. `GameCLI <plugin> --help` lists its commands even when disabled. `GameCLI <plugin> <command> --help` displays command options when enabled. The `plugins` management entry stays available and cannot be disabled. Unknown plugins/commands and invalid arguments return exit 4. Disabled plugins return exit 3 before argument parsing, network calls or Agent startup. JSON mode preserves machine-readable failure output.


## Enablement

Preferences are local execution settings stored in ~/.gamecli/plugins.json, or the GAMECLI_PLUGIN_SETTINGS override. They do not store business workflow state. Unknown and disabled commands fail before execution.

## Adding a plugin

1. Create `Plugins/<Feature>/<Feature>Plugin.cs` implementing `ICLIPlugin` or inheriting `CLIPlugin`.
2. Supply a stable lowercase ID and an immutable list of `ICommand` objects. Plugin construction should have no side effects.
3. Implement each command's parsing and service calls separately. Pass cancellation to the execution service; keep stdout machine-readable when JSON is requested.
4. Register the plugin in `Program`. No routing changes to `PluginHost` are required.

Plugin IDs are unique globally; command names are unique within their plugin. Different plugins may use the same command name. This version provides compiled-in plugins with explicit registration, not dynamic DLL discovery or hot unloading. It leaves the execution services independent of the CLI selection mechanism.

## Tests

`Tests/GameCLI.PluginSmoke` verifies dispatch, persistent disable/enable across a child process, rejection before command side effects, concurrent preference updates, duplicate IDs, protected management, empty plugins and invalid configuration. Tests use a unique temporary configuration directory and leave real user preferences unchanged.

```powershell
dotnet run --project app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/Tests/GameCLI.PluginSmoke --configuration Release
dotnet run --project app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/Tests/GameCLI.CodexSmoke --configuration Release -- .
```

Codex smoke tests now enter through `PluginHost` and `PMPlugin`; their nine transport/result checks remain intact. Live Unity smoke tests verify the migrated command against a real Editor endpoint.
