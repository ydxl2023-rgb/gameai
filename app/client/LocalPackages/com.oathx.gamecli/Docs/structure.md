# GameCLI package structure

- `GameCLI~/GameCLI/GameCLI`: C#/.NET 8 execution client. `Program` registers role and utility plugins; `Core/PluginHost` handles command dispatch and enablement. `Agents` and `Services/CodexRpcClient` retain the reusable Codex process transport.
- `GameCLI~/GameCLIServer`: Node.js/TypeScript platform service, PostgreSQL storage, Track HTTP and MCP endpoints. All business orchestration belongs here: approvals, dependencies, scheduling, leases, retries and execution records.
- `CodexPlugin~/gameai-track/ui`: React/Ant Design workbench.
- `Editor`: Unity installation, bridge and local execution monitoring; `Runtime`: shared Unity contracts.
- `game-cli`: five role skills plus shared document, coding, discovery and delivery rules. No local orchestration role is distributed.

The local Orchestrator plugin and skill have been removed. Monitor is a read-only view of local processes, not a scheduler. Executable commands include plugin management, Unity ping, PM read-only analysis, Design draft and submission. Local HTTP human approval is implemented; cloud worker dispatch remains pending.

Requirements are standalone HTML under repository-relative `app/desgin/`. PM plans one requirement with independently deliverable professional subtasks; dependencies are validated and enforced by the cloud service. Do not recreate legacy local workflow commands.

See [server architecture](../../../../../docs/gamecli-server-architecture.md) and [plugin architecture](plugins.md). Preserve source .csproj/.sln files; exclude Unity/IDE caches and build output from commits.
