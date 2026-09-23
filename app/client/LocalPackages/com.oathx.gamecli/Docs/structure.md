# Game CLI package structure

All executable development uses C#. The existing standalone console project targets .NET 8. Standard Markdown skills remain portable instructions for AI tools; they are not executable Agent implementations.

```text
com.oathx.gamecli/
|-- Docs/
|-- Editor/                      Unity Editor C# integration
|   |-- Bridge/
|   |-- Commands/
|   |-- Plugins/
|   `-- Services/
|-- Runtime/                     Unity runtime C# contracts, as needed
|-- game-cli/                    Portable standard skills
|   |-- gameai-cli-development/SKILL.md
|   |-- gameai-pm/SKILL.md
|   |-- gameai-art/SKILL.md
|   |-- gameai-dev/SKILL.md
|   |-- gameai-qa/SKILL.md
|   |-- gameai-orchestrator/SKILL.md
|   |-- gameai-common/SKILL.md
|   |-- gameai-jira/SKILL.md
|   |-- gameai-unity/SKILL.md
|   |-- examples/
|   |-- references/
|   `-- scripts/
`-- GameCLI~/                    Excluded from Unity asset import
    `-- GameCLI/
        |-- GameCLI.sln          Existing VS solution
        `-- GameCLI/
            |-- GameCLI.csproj   Existing .NET 8 console project
            `-- Program.cs      CLI entry point
```

Program dispatches capability groups. Plugins/Unity/UnityPingCommand.cs and Services implement unity --ping; future JIRA commands belong to a separate jira group. Bare ping is not supported. Core contains the plugin host; Contracts and Agents support PM execution. Tests/GameCLI.Smoke beside the console project contains executable live-bridge smoke checks. The Editor bridge and shared Runtime framing protocol are registered through package.json and assembly definitions. See [PING](ping.md) for usage and validation. The former Python scaffold has been removed by the project owner and is not restored.

JIRA is the sole source of truth for task status, approvals, retries and execution records. No SQLite database or local JIRA state file is planned. Reports and generated artifacts are not an alternative workflow state store.

Copy the required gameai-* folders into an AI tool's skill root, preserving names and sibling layout. Include referenced shared skills; the orchestrator references all four role skills. Copying all nine folders preserves every relative reference. The gameai-cli-development skill governs this repository; root AGENTS.md routes future development to it. It is not another business Agent. No automatic installation is performed.

The standalone .csproj and .sln are source files and must be versioned. Unity-generated IDE projects remain ignored, as do bin, obj and .vs. The .NET 8 console project runs outside Unity; its target framework is not the Unity runtime framework.

Editor/GameCliWindow.cs provides Tools > GameCLI > Window. Editor/Services/GameCliInstaller.cs builds the bundled CLI asynchronously into the current project's Library/GameCLI ; the window retains installation and cancellation controls and provides six command-category pages: Orchestrator, PM, Art, Development, Unity and QA. The installed unity --ping command remains available from the terminal. Installation outputs remain ignored by Git; no global PATH configuration is modified.

Editor/Bridge/GameCliCommandSettings.cs stores per-user, per-project command enablement in EditorPrefs and exposes a thread-safe cache to the pipe server. The Unity page lists command metadata with an On toggle; disabled routes return command_disabled.

The PM page starts with Editor/JiraConnectionPanel.cs: JIRA Address, visible Access Token (Bearer), save and asynchronous connection test. Services/JiraConnectionSettings.cs persists public connection metadata outside the project; WindowsCredentialStore.cs stores secrets in Windows Credential Manager; JiraConnectionClient.cs verifies the current user without following redirects. See [JIRA configuration](jira-configuration.md). PM workflow commands and standalone JIRA CLI integration remain planned.

The standalone CLI now provides `pm --analyze`: Plugins/PM/PmAnalyzeCommand.cs handles options, Agents/CodexPmRunner.cs loads the role skills and executes one read-only draft, Services/CodexRpcClient.cs owns the App Server process and JSON protocol, and Contracts/PmAnalysis.cs validates results and dependencies. Tests/GameCLI.CodexSmoke exercises the protocol using a fake child process. See [Codex PM analysis](codex-pm.md). This is a single-role execution foundation; automatic orchestration and JIRA workflow transitions remain planned.

Services/LiveRun.cs publishes transient, per-user execution discovery records. Editor/AgentMonitorPanel.cs reads them on the Orchestrator page once per second, validates PID and process start time, and shows active session/execution counts and identities. These local records contain no workflow state, credentials or requirement text; JIRA retains business state ownership.

CLI feature groups are registered ICLIPlugin modules, and every CLI command implements ICommand. Core/PluginHost.cs replaces feature switches and enforces persistent enable/disable settings. See [plugin architecture](plugins.md) for extension points, supported modules and management commands.
