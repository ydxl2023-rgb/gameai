---
name: gameai-cli-development
description: 开发和维护 ugame-ai-cli 的 C# 控制台、JIRA 编排及 Unity 桥接，并维护可分发的标准技能；用于本工程的实现、修复、测试和架构调整。
---

# Game CLI 工程开发约定

## 项目边界与入口

- 本技能针对 ugame-ai-cli。先确认目标仓库，不因 Oathx 命名转到其他 Unity 项目。
- 全部业务和工具实现使用 C#。独立 CLI 使用现有 .NET 8 工程，不恢复 Python 骨架。
- 从仓库根目录定位：`app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/GameCLI.sln`；其 `GameCLI/GameCLI.csproj` 为控制台入口工程。
- Unity 宿主为 `app/client`，当前 Unity 2022.3.62f2。Unity 代码遵守该版本的语言和 API 兼容性，不能直接套用 .NET 8 API。
- 保留既有目录和用户改动；配置路径从项目根、参数或配置解析，不将本机盘符写入可复用代码。

## C# 分层与代码规范

- `Program.cs` 负责启动和依赖组装；`Commands` 解析参数、调用用例并映射退出码，不承载业务流程。
- `Core` 放状态机与编排；`Contracts` 放 DTO、结果与显式校验；`Agents` 放四类业务角色调用适配；`Services` 放 JIRA、Git、资产与 Unity 执行器。按实际功能创建，不用空实现假装功能完成。
- 通过接口或构造参数注入外部依赖，使状态迁移和验证可独立测试。确定性调度逻辑不交给 LLM 自行决定。
- 使用四空格、Allman 大括号、显式访问修饰符和带括号的控制流；类型/方法/属性使用 PascalCase，参数和局部变量使用 camelCase。每行一个声明或语句，保持方法职责单一。
- 保持 nullable 检查开启；不要用空 catch 或随意的 null-forgiving 掩盖失败。重要数据归属、执行顺序和恢复约束使用简明注释说明。
- 网络和进程操作采用异步、超时及 CancellationToken；避免阻塞 `.Result`/`.Wait()`。进程参数使用结构化 ArgumentList，不拼接不可信 shell 命令。
- 新依赖或框架必须有当前功能需求；保持现有目标框架，升级应单独说明兼容性影响。

## JIRA、编排和人工门禁

- JIRA 是任务状态、审批、重试和执行记录的唯一可信来源。不得引入 SQLite、本地 JSON 或另一数据库保存权威流程状态；产物与日志可以落盘。
- 每次执行读取 JIRA 的最新状态、依赖及审批，只执行定义明确且满足 guard 的迁移。JIRA 不可用时暂停，不能凭缓存推进。
- PM、Art、Dev、QA 使用结构化任务和结果交互，由编排器统一调度；技能是指令，不是已运行的 Agent 服务。
- 副作用前核对执行 ID/幂等键；超时或恢复时核对远端已有结果，不能将先查后写视为原子锁。
- 重试上限和结果回写 JIRA。默认最多 3 次，区分网络重试与业务修复；拒绝、权限失败、规则缺失或次数超限时返回明确原因。
- 人工批准绑定对应需求或产物版本。不得由 Agent 自批、以旧审批批准新产物，或在合并未完成时记录完成。

## CLI 契约与安全配置

- 延续纲要退出码：0 成功、1 可重试错误、2 需修复错误、3 不可重试/需人工、4 输入契约错误、5 配置错误。
- 使用 C# DTO 和 System.Text.Json；显式校验必填字段、枚举、版本和任务依赖，不能仅以反序列化成功判定有效。
- 机器可读模式 stdout 只输出结构化结果，诊断写 stderr。记录 trace ID、issue key、输入版本和真实证据；不能伪造报告或把 stub 结果当真实验证。
- 令牌来自环境或适当凭据提供器；不写入源码、Skill、提交或日志。配置错误应指出缺失项，不回显秘密。

## Unity 与 Skill 分发

- 包内 `Editor` 放 UnityEditor、桥接和导入验证；`Runtime` 放可复用运行时契约。独立 CLI 留在 `GameCLI~`，不让 Unity 导入其源码。
- 资产变更保留已有 .meta GUID。不要为完成 CLI 工作重建用户场景或移动现有资产。
- 标准技能全部放在包根 `game-cli/<skill-name>/SKILL.md`，使用包含 name/description 的 YAML frontmatter，目录名与 name 一致。
- 五个角色技能与 common/jira/unity 公共技能保持职责边界。本开发技能负责工程约定，不增加第五个业务 Agent。
- 技能互引使用同级相对路径；分发时携带依赖，不能依赖开发机绝对路径。只按需增加 references、scripts、assets。
- 结构或契约变化同步 `Docs/structure.md` 与仓库 `docs/全AI流程规划纲要.html`，明确区分已实现与规划。

## 验证与交付

- Windows 使用 `pwsh.exe`。C# 改动构建现有解决方案：`dotnet build app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/GameCLI.sln --configuration Release`。
- 有测试后执行相关 `dotnet test`；优先覆盖状态迁移、重复事件、恢复、输入校验和退出码。尚无测试时明确说明，不把构建成功称为业务测试通过。
- 修改 Unity 行为时使用实际 Unity 入口验证；不存在的 Runner 或测试入口不得宣称通过。
- 修改技能检查 frontmatter、引用和未完成占位内容。纯说明调整执行必要检查，不为其编写镜像实现的测试。
- 提交前检查 diff 和文件清单。保留独立 CLI 的 .csproj/.sln；排除 Unity 生成工程、Library、Temp、Logs、UserSettings、bin、obj、.vs、构建产物和凭据。
- Git 提交与推送按用户授权执行，不默认 force push。连接失败先区分网络与鉴权，必要时读取实际系统代理并采用单次参数，不写死代理或擅改全局配置。
- 交付说明实际修改、验证结果和未完成事项；推送成功后报告真实提交号与目标分支。
