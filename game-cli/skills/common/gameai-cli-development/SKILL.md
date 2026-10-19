---
name: gameai-cli-development
description: 维护 GameCLI、GameAI.Server 与 Track 工程；通用 C# 编码规则独立于此技能。
---

# Game CLI 工程开发约定

## 适用范围

本技能仅用于开发维护 GameCLI、GameAI.Server 和 Track 工程，不是策划、美术或其他生产角色的默认技能。接入项目只继承通用 C# 编码规范，不继承平台目录、数据库、CLI 命令或维护流程。

## 项目边界与入口

- 本节描述 ugame-ai-cli 自身的工程入口。先确认实际目标仓库；为接入工程工作时使用该工程路径，不因引用本技能或 Oathx 命名转到其他项目。
- 独立 CLI、Unity 集成及客户端工具使用 C#，CLI 使用现有 .NET 8 工程，不恢复 Python 骨架。用户指定的集中协调服务 GameCLIServer 使用 Node.js，存放于 `game-cli/src/GameAI.Server`，这是服务端的明确例外，不要求客户端迁移语言。
- 从仓库根目录定位：`game-cli/src/GameAI.Cli/GameCLI.sln`；其 `GameCLI/GameCLI.csproj` 为控制台入口工程。
- Unity 宿主为 `app/client`，当前 Unity 2022.3.62f2。Unity 代码遵守该版本的语言和 API 兼容性，不能直接套用 .NET 8 API。
- 保留既有目录和用户改动；配置路径从项目根、参数或配置解析，不将本机盘符写入可复用代码。

## C# 职责与实现约定

- `Program.cs` 负责启动和依赖组装；`Commands` 解析参数、调用用例并映射退出码，不承载业务流程。
- `Core` 仅放 CLI 宿主与本地执行控制；业务状态机、依赖调度、审批及重试决策全部放在 GameCLIServer；`Contracts` 放 DTO、结果与显式校验；`Agents` 放 Design、PM、Prefab、Art、Development、QA 六类专业角色调用适配；`Services` 放 平台、Git、资产与 Unity 执行器。按实际功能创建，不用空实现假装功能完成。
- 通过接口或构造参数注入外部依赖，使状态迁移和验证可独立测试。确定性调度逻辑不交给 LLM 自行决定。
- 所有 CLI 命令实现 `ICommand`，所有 CLI 插件实现 `ICLIPlugin`；沿用插件宿主统一处理 enable/disable，不在命令内绕过插件开关。
- 方法职责单一，优先用有名称的小方法表达业务步骤；参数或前置条件不满足时提前返回，减少嵌套。
- 类型和成员显式声明访问级别；仅暴露调用方确实需要的成员。引用不会重新赋值的字段使用 readonly，但不将其视为集合不可变或线程安全。
- 独立 CLI 保持 nullable 检查开启；Unity 代码遵循所在程序集的语言与 nullable 设置。不要用空 catch 或随意的 null-forgiving 掩盖失败，异常应保留操作上下文。
- 重载保持相同的成功、失败及清理语义；区分操作已受理与最终完成，异步结果和取消行为必须清楚。
- 网络和进程操作采用异步、超时及 CancellationToken；避免阻塞 `.Result`/`.Wait()`。进程参数使用结构化 ArgumentList，不拼接不可信 shell 命令。
- 为请求、进程、事件订阅和其他资源明确所有者及释放入口；成功、失败、取消路径均需清理。新增单例必须有实际的共享生命周期需求，不照搬参考工程的全局服务。
- 新依赖或框架必须有当前功能需求；保持现有目标框架，升级应单独说明兼容性影响。

## 通用 C# 规范

开发和审查 C# 时读取 [C# 编码规范](../gameai-csharp-standard/SKILL.md)。本技能其余部分仅用于 GameCLI 平台自身维护，不作为所有生产角色的默认依赖。

## 平台、编排和人工门禁

- 平台服务使用 PostgreSQL 作为任务状态、审批、重试和执行记录的唯一可信来源。不得引入 SQLite、本地 JSON 或另一数据库保存权威流程状态；产物与日志可以落盘。
- 每次执行读取 平台 的最新状态、依赖及审批，只执行定义明确且满足 guard 的迁移。平台 不可用时暂停，不能凭缓存推进。
- Design、PM、Prefab、Art、Development、QA 使用结构化任务和结果交互，由编排器统一调度；技能是指令，不是已运行的 Agent 服务。
- 副作用前核对执行 ID/幂等键；超时或恢复时核对远端已有结果，不能将先查后写视为原子锁。
- 重试上限和结果回写 平台。默认最多 3 次，区分网络重试与业务修复；拒绝、权限失败、规则缺失或次数超限时返回明确原因。
- 人工批准绑定对应需求或产物版本。不得由 Agent 自批、以旧审批批准新产物，或在合并未完成时记录完成。
- 需求必须在当前 Codex 对话反复讨论并明确确认具体版本。初稿确认前不建单；正式 HTML 经 Track 人工审批后，PM 审查并由服务端事务性建单。问题只在对话处理，不写入单据正文。

## CLI 契约与安全配置

- 命令按功能分组：`GameCLI <group> [options]`。命令参数以当前 `--help` 和实现为准；Unity 操作调用目标工程安装的独立 Unity CLI，不使用已移除的平台内置 Unity 命令。Program 只分发命令组，各组自行解析操作与参数；尚未实现的组明确报错，不提供假成功入口。

- 延续纲要退出码：0 成功、1 可重试错误、2 需修复错误、3 不可重试/需人工、4 输入契约错误、5 配置错误。
- 使用 C# DTO 和 System.Text.Json；显式校验必填字段、枚举、版本和任务依赖，不能仅以反序列化成功判定有效。
- 机器可读模式 stdout 只输出结构化结果，诊断写 stderr。记录 trace ID、task ID、输入版本和真实证据；不能伪造报告或把 stub 结果当真实验证。
- 令牌来自环境或适当凭据提供器；不写入源码、Skill、提交或日志。配置错误应指出缺失项，不回显秘密。

## Unity 与 Skill 分发

- 平台 CLI 位于 `game-cli/src/GameAI.Cli`，服务位于 `game-cli/src/GameAI.Server`，插件位于 `game-cli/plugins/`，角色技能位于 `game-cli/skills/`。平台不得引用 Unity 包源码；Unity 操作由独立外部 CLI 执行，Unity 工程只保存自身 Editor/Runtime 代码。
- 资产变更保留已有 .meta GUID。不要为完成 CLI 工作重建用户场景或移动现有资产。
- 标准主技能放在 `game-cli/skills/<role>/<AgentName>/SKILL.md`，专业子技能放在对应主技能目录的 `<specialist-name>/SKILL.md`，使用包含 name/description 的 YAML frontmatter，保留用户约定的英文角色目录；frontmatter name 使用合法技能标识。
- Design、PM、Prefab、Art、Development、QA 六个角色技能与 common 公共技能保持职责边界。本开发技能负责工程约定，不增加业务 Agent。
- 技能互引使用相对路径；子技能通过 `../SKILL.md` 引用所属主技能；分发时携带依赖，不能依赖开发机绝对路径。只按需增加 references、scripts、assets。
- 新增或修改技能优先保持单一职责；可复用专项规则独立为技能，由角色主技能引用。宿主禁用文件读取时，必须显式加载所需依赖技能内容，不能只传入无法打开的链接。
- 协调服务使用版本化 JSON 与 WebSocket 协议；事件通知不等于派工授权。Node.js 依赖提交 package.json 和锁文件，不提交 node_modules、真实 .env 或令牌。服务端遵守单一职责、四空格、Allman 大括号、英文源码注释及可取消的连接生命周期约定；C# 属性排版规则不机械套用到 JavaScript。
- 结构或契约变化同步 `Docs/structure.md` 与仓库 `docs/全AI流程规划纲要.html`，明确区分已实现与规划。

## 验证与交付

- Windows 使用 `pwsh.exe`。C# 改动构建现有解决方案：`dotnet build game-cli/src/GameAI.Cli/GameCLI.sln --configuration Release`。
- 有测试后执行相关 `dotnet test`；优先覆盖状态迁移、重复事件、恢复、输入校验和退出码。尚无测试时明确说明，不把构建成功称为业务测试通过。
- 修改 Unity 行为时使用实际 Unity 入口验证；不存在的 Runner 或测试入口不得宣称通过。
- 修改技能检查 frontmatter、引用和未完成占位内容。纯说明调整执行必要检查，不为其编写镜像实现的测试。
- 提交前检查 diff 和文件清单。保留独立 CLI 的 .csproj/.sln；排除 Unity 生成工程、Library、Temp、Logs、UserSettings、bin、obj、.vs、构建产物和凭据。
- Git 提交与推送按用户授权执行，不默认 force push。连接失败先区分网络与鉴权，必要时读取实际系统代理并采用单次参数，不写死代理或擅改全局配置。
- 交付说明实际修改、验证结果和未完成事项；推送成功后报告真实提交号与目标分支。

## 专业需求同步登记

对话初稿获批后由 Design 编写、CLI 编译并经 Design 自检；正式 HTML 经 Track 人工审批后，PM 才按当前契约审查生产任务，按 PM 的交付标准拆分规范（处理拆分任务时读取 `../../pm/RodFergusson/SKILL.md`） 创建可独立交付、独立验收的子任务，同一专业可以有多项。单据登记不等于开始制作、编码或测试。依赖精确到实际使用的前置产物，测试依赖对应交付任务；按拓扑顺序登记，执行前核验所有前置交付。已发布计划及编号在恢复时原样复用，禁止重复创建；计划迁移统一经云端接口执行，接口未实现时明确阻塞。

客户端不得实现第二套业务调度或恢复决策。GameCLIServer 负责状态、审批、依赖、任务分配、租约与重试；GameCLI 仅通信、执行云端授权任务、启动 Agent 和回传结果。当前本机固定角色派发、授权后的同计划推进与有限失败恢复已实现；远程 worker 派发仍待实现，不得由客户端另建调度器。

## 用户阅读文档格式

向用户交付的文档必须遵守 纲要式文档输出规范（交付阅读文档时读取 `../gameai-document-format/SKILL.md`），由当前对话宿主生成带封面、目录及打印样式的独立 HTML 阅读版。Agent 仍返回规定的结构化结果，标准技能仍使用 SKILL.md，任务正文格式保持单据规范。

## 专业任务的云端核验上下文

GameCLIServer 在派发、固定 Agent claim、执行结束三个阶段负责平台核验；Agent 输入中的 platform_context 是本次数据库核验结果，而非离线缓存。该上下文标明 authoritative、validated_at、requirement_version_id 和 plan_version_id 时，Agent 可以按授权任务执行，不自行访问数据库或猜测 HTTP 端口。服务失联由 GameCLI 心跳取消执行；模型只交付结果与证据，不持有平台凭据或自行回写状态。

## Track 数据列表列宽规范（强制）

- Track 中所有以列展示的同类数据列表（包括页面、树形任务和弹窗预览），必须支持拖动表头分隔线调整列宽，并支持左右方向键微调。
- 统一使用 UI 的 `ResizableTable`，不得直接新增不支持列宽调整的 Ant Design `Table`。每个列表提供独立稳定的 `storageKey`；列配置使用稳定的 key 或 dataIndex。
- 列宽按列表保存，切换分页、刷新数据及重载页面后保持；宿主禁止本地存储时降级为内存设置。设置合理最小宽度，超出容器时横向滚动，不能挤压回原宽度。
- 必须保留原有排序、筛选、固定列、树形展开、勾选与操作按钮；普通描述字段和文档正文不属于本规则的数据列表。
