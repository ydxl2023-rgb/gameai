# GameCLI package structure

- `GameCLI~/GameCLI/GameCLI`: C#/.NET 8 execution client. `Program` registers role and utility plugins; `Core/PluginHost` handles command dispatch and enablement. `Agents` and `Services/CodexRpcClient` retain the reusable Codex process transport.
- `GameCLI~/GameCLIServer`: Node.js/TypeScript platform service, PostgreSQL storage, Track HTTP and MCP endpoints. All business orchestration belongs here: approvals, dependencies, scheduling, leases, retries and execution records.
- `CodexPlugin~/gameai-track/ui`: React/Ant Design workbench.
- `Editor`: Unity installation, bridge and local execution monitoring; `Runtime`: shared Unity contracts.
- `game-cli`: five role skills plus shared document, coding, discovery and delivery rules. No local orchestration role is distributed.

The local Orchestrator plugin and skill have been removed. Monitor is a read-only view of local processes, not a scheduler. Executable commands include plugin management, Unity ping, PM read-only analysis, Design draft and submission. Local HTTP human approval is implemented; cloud worker dispatch remains pending.

Requirements are standalone HTML under repository-relative `app/desgin/`. PM plans one requirement with independently deliverable professional subtasks; dependencies are validated and enforced by the cloud service. Do not recreate legacy local workflow commands.

See [server architecture](../../../../../docs/gamecli-server-architecture.md) and [plugin architecture](plugins.md). Preserve source .csproj/.sln files; exclude Unity/IDE caches and build output from commits.

### 手动 PM 任务发布

- `GameCLI/Plugins/PM/PmPlanCommand.cs`：固定 PM 结构化计划命令，云端提供执行编号。
- `GameCLIServer/src/database/pm-plans.js`：已批准版本门禁、幂等记录、依赖校验、主子任务原子发布。
- `GameCLIServer/src/track/pm-dispatch.js`：本机 CLI 进程及结果提交；`migrations/006_manual_pm.sql` 保存作业、任务正文和来源。
- `CodexPlugin~/gameai-track/ui/src/PmSplitButton.tsx`：人工手动启动、执行状态及重试入口。当前不自动派工。
