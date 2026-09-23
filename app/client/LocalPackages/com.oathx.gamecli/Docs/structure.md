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
|   |-- gameai-design/SKILL.md
|   |-- gameai-pm/SKILL.md
|   |-- gameai-art/SKILL.md
|   |-- gameai-dev/SKILL.md
|   |-- gameai-qa/SKILL.md
|   |-- gameai-orchestrator/SKILL.md
|   |-- gameai-common/SKILL.md
|   |-- gameai-jira/SKILL.md
|   |-- gameai-jira-issue-writing/SKILL.md
|   |-- gameai-task-delivery/SKILL.md
|   |-- gameai-mobile-requirements/SKILL.md
|   |-- gameai-unity/SKILL.md
|   |-- examples/
|   |-- references/
|   `-- scripts/
`-- GameCLI~/                    Excluded from Unity asset import
    |-- GameCLIServer/           Node.js JIRA Webhook and WebSocket event service
    |   |-- src/
    |   |-- test/
    |   |-- package.json
    |   `-- package-lock.json
    `-- GameCLI/
        |-- GameCLI.sln          Existing VS solution
        `-- GameCLI/
            |-- GameCLI.csproj   Existing .NET 8 console project
            `-- Program.cs      CLI entry point
```

Program dispatches capability groups. Plugins/Unity/UnityPingCommand.cs and Services implement unity --ping; future JIRA commands belong to a separate jira group. Bare ping is not supported. Core contains the plugin host; Contracts and Agents support PM execution. Tests/GameCLI.Smoke beside the console project contains executable live-bridge smoke checks. The Editor bridge and shared Runtime framing protocol are registered through package.json and assembly definitions. See [PING](ping.md) for usage and validation. The former Python scaffold has been removed by the project owner and is not restored.

JIRA is the sole source of truth for task status, approvals, retries and execution records. No SQLite database or local JIRA state file is planned. Reports and generated artifacts are not an alternative workflow state store.

Copy the required gameai-* folders into an AI tool's skill root, preserving names and sibling layout. Include referenced shared skills; the orchestrator references all five professional role skills. Copying all thirteen folders preserves every relative reference. Design and PM load gameai-jira-issue-writing for Chinese issue titles, lists, rules and test cases; the host explicitly includes this dependency in agent instructions. The gameai-cli-development skill governs this repository; root AGENTS.md routes future development to it. It is not another business Agent. No automatic installation is performed.

The standalone .csproj and .sln are source files and must be versioned. Unity-generated IDE projects remain ignored, as do bin, obj and .vs. The .NET 8 console project runs outside Unity; its target framework is not the Unity runtime framework.

Editor/GameCliWindow.cs provides Tools > GameCLI > Window. Editor/Services/GameCliInstaller.cs builds the bundled CLI asynchronously into the current project's Library/GameCLI ; the window retains installation and cancellation controls and provides six command-category pages: Orchestrator, Design, PM, Art, Development and QA. Design currently displays an unimplemented-command notice; its Agent is available through Orchestrator, while standalone Design commands remain planned. The installed unity --ping command remains available from the terminal. Installation outputs remain ignored by Git; no global PATH configuration is modified.

Editor/Bridge/GameCliCommandSettings.cs stores per-user, per-project command enablement in EditorPrefs and exposes a thread-safe cache to the pipe server. The Unity page and its command toggle UI have been removed; existing enablement preferences and bridge behavior remain in place. Disabled routes return command_disabled.

The PM page starts with Editor/JiraConnectionPanel.cs: JIRA Address, Project Key, visible Access Token (Bearer), save and asynchronous connection test. Services/JiraConnectionSettings.cs persists public connection metadata outside the project; WindowsCredentialStore.cs stores secrets in Windows Credential Manager; JiraConnectionClient.cs verifies the current user without following redirects. See [JIRA configuration](jira-configuration.md). The PM manual Create Task form has been removed; the panel retains connection configuration and testing. Plugins/Jira/JiraCreateCommand.cs and Services/JiraTaskClient.cs implement jira --create with saved Project Key, title and optional description. Editor/Services/JiraTaskCliClient.cs remains an unused CLI adapter after removal of the manual form. The native Windows credential implementation is shared with the CLI through a linked source file; it has no Unity dependencies. The Codex conversation is the document/review/approval entry point; root AGENTS.md routes workflow requests to gameai-orchestrator. The Unity Orchestrator page only monitors active agents. The workflow starts Design, immediately registers discovered Art, Development and QA scopes, then reuses those issues in the reviewed PM plan without duplicate creation through a controlled tool. See [workflow commands](orchestrator-workflow.md). Development completion resolves a native transition from the current JIRA workflow; Art spot review and final QA acceptance remain human gates.

The standalone CLI now provides `pm --analyze`: Plugins/PM/PmAnalyzeCommand.cs handles options, Agents/CodexPmRunner.cs loads the role skills and executes one read-only draft, Services/CodexRpcClient.cs owns the App Server process and JSON protocol, and Contracts/PmAnalysis.cs validates results and dependencies. Tests/GameCLI.CodexSmoke exercises the protocol using a fake child process. See [Codex PM analysis](codex-pm.md). This legacy command remains read-only. The new Core/RequirementWorkflow.cs and Agents/CodexWorkflowAgent.cs implement the independent Design-to-PM chain; Services/JiraWorkflowStore.cs persists authoritative snapshots in JIRA issue properties. Development completion resolves a native transition from the current JIRA workflow; Art spot review and final QA acceptance remain human gates.

Services/LiveRun.cs publishes transient, per-user execution discovery records. Editor/AgentMonitorPanel.cs reads them on the Orchestrator page once per second, validates PID and process start time, and shows active session/execution counts and identities. These local records contain no workflow state, credentials or requirement text; JIRA retains business state ownership.

CLI feature groups are registered ICLIPlugin modules, and every CLI command implements ICommand. Core/PluginHost.cs replaces feature switches and enforces persistent enable/disable settings. See [plugin architecture](plugins.md) for extension points, supported modules and management commands.

Core/EarlyTaskPublisher.cs registers Development and QA scopes after the legacy-compatible EarlyArtPublisher.cs registers Art. JIRA snapshots retain each creation intent and verified issue identity. Approval authorizes later workflow progression, not initial scope registration.

## 默认任务层级

每份需求登记为一个主任务；策划产出的美术、程序开发、测试验收需求立即登记为该主任务下的真实子任务。子任务使用项目配置的子任务类型与父任务字段，描述链接不能替代层级。父子关系表示归属，依赖仍单独记录。恢复时核对项目、类型、父任务和稳定标签，错误父任务或旧独立任务必须先修正，不自动新建替代。已有单据通过 Jira 转换流程保留编号与内容。

单条命令支持 `jira --create --parent <主任务编号>`；省略父任务创建主任务。配置缺少子任务类型时明确失败，不降级为独立任务。

## 专业交付门禁

Contracts/TaskDelivery.cs 定义子任务交付、证据和输入版本；Core/DeliveryWorkflow.cs 按依赖图读取最新 JIRA 并串行派工；Services/DeliveryVerifier.cs 校验实际文件。交付记录存储在子任务的 gamecli.delivery.v1 属性。专业代理使用工程写入沙箱执行本地制作与验证，仍禁用继承的外部工具，不能自批或修改 JIRA。美术经抽检并在 JIRA 完成后再次 dispatch 放行程序；程序交付校验通过自动完成并启动验收；最终验收保留人工关口。gates 提供只读诊断，DeliverySmoke 覆盖版本失效及恢复边界。

## 集中协调事件服务

Node.js 服务位于 GameCLI~/GameCLIServer，属于服务器端明确的技术例外。C# 的 Contracts/ServerEnvelope.cs 定义消息封装，Services/ServerEventClient.cs 管理 WebSocket 注册、心跳及重连，Plugins/Orchestrator/ConnectCommand.cs 提供 orchestrator --connect。当前只接收事件，不进行分布式派工或自动启动代理。node_modules、真实 .env 与凭据不提交，package-lock.json 保留。

完整协议、配置及后续集中调度方案见 [协调服务设计](../../../../../docs/gamecli-server-architecture.md)。
