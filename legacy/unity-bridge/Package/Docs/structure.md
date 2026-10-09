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

### 任务树与派发许可

- `ui/src/task-tree.ts` 与 `components.tsx`：主任务展开、专业子任务独立选择，筛选保留层级。
- `GameCLIServer/src/database/task-dispatch-selection.js`：人工会话下的版本校验、选择保存与审计；选择不会创建执行。
- `migrations/008_task_dispatch_selection.sql`：人工派发许可、选择版本、操作人和时间。未来派工必须核验此许可及既有依赖门禁。

### 专业子技能目录

`game-cli` 的 Design、Art、Development、QA 主技能分别引用内部专业子目录，每个子目录使用标准 `SKILL.md`：

- Design：`design-system`、`design-battle`、`design-excel`。
- Art：`art-ui`、`art-2d`、`art-3d`、`art-animation`、`art-vfx`。
- Development：`dev-unity`、`dev-cocos`、`dev-godot`、`dev-web`。
- QA：`qa-unity`、`qa-cocos`、`qa-godot`、`qa-web`。

已实现嵌套技能扫描登记、角色匹配选择和执行时依赖加载。子技能使用主目录／子目录作为唯一编号，名称保留子目录名；主技能仍为角色入口。执行加载所选专业、所属主技能和公共依赖，去重并校验内容哈希；不加载未选择的同级专业。技能添加不改变 Agent 权限，也不创建专业 Agent。控制台任务继续使用 Development／QA 主技能。

### 公共规则与专项归属

`gameai-common` 包含 task-writing、task-delivery、document-format（及 assets）、mobile-requirements、cli-development 五项公共子技能，目录名保留 `gameai-` 前缀。requirement-discovery 归入 gameai-design，qa-repair 归入 gameai-qa；返修规则继续供 Development 使用。公共入口按需加载，编码规范仍是强制依赖。

技能同步事务迁移旧编号的 Agent 绑定，保持授权和历史不变，已有新绑定幂等复用；存在进行中或待核实执行时拒绝迁移。CLI 加载路径、模板路径及各技能相对引用使用新目录。

### Unity 开发与验证统一入口

Unity 验证规则已合并到 `game-cli/gameai-dev/dev-unity/SKILL.md`，旧 gameai-unity 目录已移除。Development 使用完整技能，QA 仅引用 `#unity-validation` 验证章节；执行加载器校验完整技能哈希后提取章节，不向 QA 注入开发职责。同步事务将两种旧编号统一迁移为 gameai-dev/dev-unity，已有绑定去重，授权与历史保持不变。
