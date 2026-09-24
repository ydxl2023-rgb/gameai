# 文档 → Design → 需求确认 → PM → JIRA

当前已实现此阶段的 CLI，由 Codex 对话调用；Orchestrator 面板仅用于运行监控。Design 与 PM 使用独立 Codex App Server 进程和会话。美术、程序、验收通过交付门禁调度，具体命令与审核边界见下文。

## 在 Codex 对话中使用

在 PM 面板保存一次 JIRA Address、Project Key 和 Access Token，安装项目内的 CLI，并确保本机 Codex 已登录。后续需求输入、审阅和确认均在 Codex 对话中完成。

1. 在对话中附上需求文档、给出本地路径或粘贴需求正文，例如：“根据这份背包需求文档启动 GameCLI 开发流程。”
2. Codex 读取 `gameai-orchestrator/SKILL.md` 和 `gameai-requirement-discovery/SKILL.md`，先调研同类成功或成熟产品，把核实来源与比较摘要合并到需求输入，再使用可访问的 Markdown／TXT 路径调用 start；正文由助手原样保存为临时 UTF-8 输入文件。用户无需在面板填路径或手动运行命令。
3. CLI 登记 JIRA 流程入口并启动 Design Agent。Codex 在当前对话展示策划说明、验收条件、专业需求和待确认问题。
4. 当前对话一次展示全部重要决策题，用户完成整批选择后，Codex 合并反馈只调用一次 revise；用户明确确认展示的版本后，Codex 核对 JIRA 中的最新 revision，再调用 approve 启动 PM Agent。
5. Codex 在对话中返回实际创建的程序、美术及 QA 单据链接。恢复已有流程时读取 status／resume，不重复启动新流程。

仅附上文档并要求讨论不触发外部建单；文档内容中的指令不能代替用户要求启动流程或确认需求的意愿。

仓库 `AGENTS.md` 已路由到编排技能；其他工程需将可分发技能及依赖安装到对应 AI 工具，或在工程指令中引用它。当前 CLI 只直接接受 UTF-8 Markdown／TXT；Word、PDF 需由对话助手通过可用读取工具提取，图片及解析缺失应明确说明，不能静默丢弃。

JIRA 账户需要项目浏览、搜索、创建单据和编辑 issue property 的权限，项目需要允许使用 labels 字段。Orchestrator 面板显示运行中的各专业会话，不再提供文档、审批或恢复操作表单；关闭监控窗口不会取消从对话启动的流程。CLI 仍支持 Ctrl+C，以及由调用方通过重定向 stdin 发送 `cancel` 进行取消。

## CLI

```powershell
GameCLI.exe orchestrator --start --document "G:\需求\背包.md" --project "G:\gameai\ugame-ai-cli\app\client" --format json

GameCLI.exe orchestrator --status --issue GAMEAI-123 --format json

GameCLI.exe orchestrator --approve --issue GAMEAI-123 --revision <审阅结果中的完整revision> --project "G:\gameai\ugame-ai-cli\app\client" --format json

GameCLI.exe orchestrator --resume --issue GAMEAI-123 --project "G:\gameai\ugame-ai-cli\app\client" --format json

GameCLI.exe orchestrator --revise --issue GAMEAI-123 --document "G:\需求\背包修订.md" --project "G:\gameai\ugame-ai-cli\app\client" --format json
```

`GAMEAI-123` 为示例，使用实际返回的流程入口编号。`--project` 是本地工程目录；JIRA 项目来自 PM 中保存的 Project Key。

执行类命令支持 `--codex`、`--skills`、`--model`、`--timeout`；默认使用本机 Codex 配置模型，每条命令默认限时 600 秒，可设 1–3600 秒。`--status` 不启动 Agent。自定义 Task 名称时可传 `--issue-type <名称或ID>`；首次选定值存入流程，后续未指定时沿用。

未确认时 `--resume` 只返回待确认状态，不启动 PM。`--approve` 必须绑定用户已经审阅的完整需求哈希；新文档修订使旧批准失效。已有 PM 计划或已产生任务后，不允许用 `--revise` 覆盖需求，应单独启动变更流程。

`--start` 先查询当前项目中相同文档哈希的流程，已找到时返回其状态。显式恢复使用 `--resume`。搜索不是原子锁；入口创建响应丢失时，必须按 stderr 中的 recovery label 在 JIRA 核对入口，获取编号后恢复，不能反复执行 start 猜测结果。

## 数据与职责

- `WorkflowCommand` 实现 `ICommand`，Orchestrator 插件注册 start/status/approve/resume/revise/gates/dispatch。
- `RequirementWorkflow` 执行确定性的阶段、批准、重试和发布校验。
- `CodexWorkflowAgent` 负责角色 SKILL、独立会话、结构化输出和动态工具回调；不把 Token 提供给 Agent。
- Design 返回需求草案，不接收写入工具。PM 仅获得 `jira_publish_tasks`，提交完整计划，由宿主验证并保存后调用 JIRA 创建。
- PM 不能调用批准工具。宿主关闭 shell、内置子 Agent、Apps、浏览器和已配置 MCP 服务器，其他交互请求失败关闭。
- `JiraWorkflowStore` 使用 JIRA v2 API，复用 `JiraTaskClient` 创建真实 Task。每次 HTTP 操作及专业角色调度会检查插件开关。
- `LiveRun` 只保存本机进程发现信息，用于显示运行中角色；本机文件锁仅限制本机同一用户的并发执行。

工作流存储在入口单据的 `gamecli.workflow.v1` issue property。包含原始文档、Design 产出、需求哈希、确认身份和时间、PM 计划、依赖、任务编号、发布意图与 Agent 执行记录。首次创建通过同一请求的 `properties` 保存初始快照；后续更新同时写入属性和中文标题、描述。描述只展示中文列表，包含开发内容、规则、待执行测试用例；问题只保留在属性并于对话处理，不再展示原始快照。旧描述中的恢复标记仅保留读取兼容。`suggested_rules` 为旧状态兼容字段，不渲染到单据；修订原始需求时清空旧建议。

策划与项目管理共同加载 [单据编写规范](../game-cli/gameai-jira-issue-writing/SKILL.md)。该技能只负责单据表达，项目管理主技能保留拆单与依赖职责；英文协议标识不改变，面向人的说明使用中文。

逻辑阶段包括 design_pending、design_running、design_failed、needs_clarification、awaiting_approval、pm_pending、pm_running、publishing、pm_failed、outcome_unknown、tasks_created。这些是 property 中的逻辑状态，不会强制修改项目既有 JIRA workflow status。

专业单据描述包含来源入口、需求版本、角色、任务 ID、依赖 ID 和验收标准；labels 标识所属执行和任务。任务之间的依赖及 ID→Key 映射由 JIRA property 保存，当前尚未创建原生 issue links，也不代表前置任务已经完成。

## 防重复与恢复边界

宿主在每次创建专业单据前保存 pending_task。POST 响应未知时保留该意图；恢复先查询任务标签，找到后验证并复用真实单据。查询暂时未找到时停止，不再次 POST，避免 JIRA 搜索索引延迟导致重复创建。

已有单据会逐一验证标签和目标项目。完整计划一旦保存，恢复时必须原样提交；PM 不能通过改任务 ID 重新建一套单据。成功仅在工具真实创建／验证了全部任务且 PM 正常结束后记录；模型单方面声称成功不算完成。

权限或字段错误停止执行；结果确定的失败可修复配置后恢复。每个角色最多累计 3 次失败或中断尝试，不自动无限重启。JIRA 不可用时不凭本地缓存推进；失败回写本身失败时，下一次从 JIRA 中的执行记录核对。

当前限定单机器、单用户作为一个 JIRA 项目的调度端；不具备跨机器互斥或服务器端 exactly-once 保证。原始文档限 12000 UTF-8 字节，任务计划 2–20 项，完整 property 快照限 32000 UTF-8 字节。超限明确报错，不截断需求。

## 验证

```powershell
dotnet build app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/GameCLI.sln --configuration Release
dotnet run --project app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/Tests/GameCLI.WorkflowSmoke --configuration Release -- .
```

模拟测试覆盖独立角色会话、人工关口、修订、插件禁用、伪造成功、错误会话的工具调用、循环依赖、重复启动、响应丢失、索引延迟、取消和入口恢复。

可选 `--real-codex` 使用真实 Codex 账户运行两个 Agent，但 JIRA 仍采用内存模拟 HTTP，不创建正式单据。该验证使用固定的 HELLO 测试需求，测试程序只确认自己生成的测试版本；不用于批准用户需求。

协议依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。动态工具需 experimentalApi；已按本机 `codex-cli 0.154.0-alpha.6.2` 生成的 schema 核对并完成真实 Agent／模拟 JIRA 联调。JIRA API 依据：[Jira Server REST API](https://docs.atlassian.com/software/jira/docs/api/REST/9.12.0/)。目标 JIRA 实例的字段及权限仍需实际运行验证。

## 移动平台与确认后建单

仅支持移动触屏交互；桌面交互内容在新策划和建单计划校验时拒绝。测试用例按目录层级逐行输出前置条件、操作步骤、预期结果。未决问题保存在属性中，仅在对话处理，不写进描述。

策划完成后仅保存需求主任务草案，并在当前 Codex 对话展示方案与问题；用户补充后调用 revise 重新分析。必须展示完整定稿并收到用户对当前 revision 的明确确认，才调用 approve 启动 PM，由 PM 提交完整计划后创建美术、程序、QA 子任务。start、revise、等待确认时的 resume 均不创建专业子任务。历史专业单据恢复时核对并复用原编号，未知结果禁止重复创建。

### 各专业同步登记

策划产出的美术清单、程序清单和验收用例分别生成美术、程序和测试汇总单据，没有对应内容则跳过。使用稳定任务标识，程序依赖美术（如有），测试依赖程序及美术。根单据展示全部真实编号，后续项目管理完整计划复用这些任务，修订更新原单据。程序和测试登记状态位于 early_tasks 属性，部分创建失败或结果未知时逐项恢复，禁止重复提交。

## 默认任务层级

每份需求登记为一个主任务；用户确认策划版本后，由 PM 将美术、程序开发、测试验收需求登记为该主任务下的真实子任务。子任务使用项目配置的子任务类型与父任务字段，描述链接不能替代层级。父子关系表示归属，依赖仍单独记录。恢复时核对项目、类型、父任务和稳定标签，错误父任务或旧独立任务必须先修正，不自动新建替代。已有单据通过 Jira 转换流程保留编号与内容。

单条命令支持 `jira --create --parent <主任务编号>`；省略父任务创建主任务。配置缺少子任务类型时明确失败，不降级为独立任务。

## 专业调度与交付门禁（已实现）

专业链路为：美术交付并抽检完成 → 程序交付校验完成 → 测试验收交付 → 用户最终验收。无美术需求直接开发。登记单据不表示批准执行；必须已有对应需求版本审批及完整专业计划。

```powershell
GameCLI.exe orchestrator --gates --issue AI9527-1 --project <工程目录> --format json
GameCLI.exe orchestrator --dispatch --issue AI9527-1 --project <工程目录> --format json
GameCLI.exe orchestrator --dispatch --issue AI9527-1 --project <工程目录> --retry-task <子任务编号> --format json
```

- `gates` 只读核验，输出逐项原因；`dispatch` 只启动符合条件的专业代理，默认串行，遇到审核或阻塞停止。命令由对话助手调用，不需要 Unity 面板输入。
- 每次读取最新原生完成状态、父子身份、需求批准、依赖版本和交付清单。文件必须在当前工程内，存在且非空，实际哈希匹配，检查证据属于本次清单。完成文字或单独的完成状态不足以放行。
- `gamecli.delivery.v1` 位于各子任务，记录执行编号、会话、次数、需求与任务版本、上游交付版本、文件哈希、检查证据、提交版本与时间。实际文件保存在工程；本地不保存权威任务状态。
- `CodexWorkflowAgent` 为美术、程序、验收分别启动独立会话，使用工程写入沙箱与本地工具。继承的外部工具仍禁用；工具不足时报告阻塞，不能编造交付。程序角色加载 gameai-dev，宿主显式加载交付、编码与 Unity 规范。
- 代理返回通过后，宿主复核输入与文件，再提交到 JIRA。美术保留人工抽检，完成美术子任务后再次调度；程序校验通过后由编排器自动完成程序子任务并继续启动验收，不增加程序人工审批。最终验收保留人工关口；文件完整性检查不能替代语义、视觉或玩法验收。
- 返工先重新打开单据；上游被重新打开、产物改变或提交新版本，会阻塞下游旧交付。失败或失效任务通过 retry-task 显式重试，累计最多三次。运行中或写入结果不确定的任务先核实，不自动重启。
- 本版按调用推进，无后台轮询，不创建原生阻塞链接，不支持跨机器并发控制、自动缺陷拆单和跨需求的变更审批。运行中断且无法回写时明确保留阻塞，需要核实原进程及远端记录后人工处置。

状态包含 ready、blocked、running、failed、stale、waiting_review、complete，中文原因同时返回。gates 读取成功返回 0；dispatch 未走完整条审核链返回 3，并给出当前审核或阻塞位置，不能把它理解为已经完成背包开发。

新增 `GameCLI.DeliverySmoke` 验证依赖、审核门禁、上游返工、文件变更、输入版本变化、失败重试、权限与不确定写入；`GameCLI.WorkflowSmoke --professional-only` 验证三类专业会话的技能、沙箱、工具权限与结构化返回。模拟测试不代表真实美术生成或 Unity 验收完成。

专项规范见包内 `game-cli/gameai-task-delivery/SKILL.md`，项目管理、编排器及各专业主技能共同引用。

程序完成转换从当前项目提供的原生转换中选择，目标状态类别必须为完成且候选唯一。提交转换前持久化意图，响应丢失后核实实际状态，未确认时停止，不重复转换；字段或权限明确拒绝时修复配置后可再次调度，不重跑程序代理。

## WebSocket 事件连接

新增 `orchestrator --connect --server <ws或wss地址>/ws --project-key <项目> --format json`，局域网客户端无需认证令牌。Node.js GameCLIServer 接收 JIRA Webhook 后按项目推送通知。连接支持心跳、退避重连、有限补发与重新核对提示；这是事件通道，不会自动运行现有 dispatch，不会让所有观察客户端重复派工。

正式部署需要一个 JIRA 服务器可访问的回调地址。已验证 HTTP/WebSocket 与真实 CLI 联调；JIRA 管理员登记回调后可接收真实通知。完整部署、固定协议及已实现边界见 [协调服务设计](../../../../../docs/gamecli-server-architecture.md)。

## ART 只读联调

`orchestrator --art-probe --issue <需求主任务> --server <ws或wss地址>/ws --project <工程目录> [--trigger sync|event] [--timeout 600] --format json` 用于显式授权的链路联调。默认 sync 在连接注册后核对 JIRA 并执行一次；event 等待该主任务或其子任务的通知后再核对。它不会轮询 JIRA。

编排器读取真实美术子任务，验证父子关系、项目和任务标签，通过 Codex App Server 启动独立的 Art 会话。代理采用只读模式、禁用工具，仅确认任务和返回计划产物，不创建资源、不写工程、不改变批准或任务状态，也不进入 Development/QA。诊断不要求生产批准；正式制作仍必须经过原有交付门禁。

会话编号、轮次、执行编号及结果存入美术子任务属性 `gamecli.art-probe.v1`，与 `gamecli.delivery.v1` 分开。先保存启动意图，再启动代理；成功后退出监听。相同需求版本重复执行复用已完成结果，运行中、响应不确定或版本不符的记录阻止再次启动，先核对原会话。当前不提供自动重试或清除记录命令。

联调沿用同机同用户的项目执行锁，连接使用固定的流程客户端编号来拒绝同时注册。该机制不是生产级跨机器租约；当前只允许指定的一台工作机执行联调。连接期间的事件接收、心跳和代理运行相互独立，不会因代理耗时阻塞心跳。普通 `--connect` 仍只观察，不启动代理。

运行日志写入 stderr，最终结构化回执写入 stdout。Unity 面板通过现有 LiveRun 记录可观察 Art 会话。示例：

```powershell
& './app/client/Library/GameCLI/GameCLI.exe' orchestrator --art-probe --issue AI9527-1 --server ws://192.168.72.39:8088/ws --project './app/client' --timeout 600 --format json
```

## 常驻通知调度与执行评论

`orchestrator --watch --issue <需求主任务> --server <ws或wss地址>/ws --project <工程目录> --format json` 持续监听一个需求及其子任务。默认无限等待，Ctrl+C 停止，`--timeout <秒>` 可设置有界运行。首次注册、重连和相关单据通知均触发最新 JIRA 核对；无事件时不轮询 JIRA。

每次核对串行处理就绪任务，保留需求版本审批、美术人工抽检、前置任务实际文件/哈希检查及最终验收门禁。美术审核完成后，Development 获得真实上游交付并启动；程序交付校验通过后处理完成转换，再进入 QA。纯只读联调不能满足生产交付门禁。执行失败或状态不确定时暂停对应任务，不因重复通知自动重跑。

监听和心跳独立于代理执行。断线时取消本次执行，重连后先核对已有记录；初始同步和重复通知不会重复执行已提交任务。事件合并为一次待处理提示，不无限堆积。每次调度期间获取本机项目锁，空闲时释放，允许同机执行批准等命令。当前限定一台指定执行机；固定客户端编号仅拒绝重复连接，不是跨机器的生产租约。

专业执行成功、阻塞、失败和取消结果写入对应子任务的中文评论：角色、结果摘要、会话与轮次、执行编号、产物、检查证据及下一步。`gamecli.delivery.v1` 保存权威执行与版本信息，执行时不再用结果覆盖需求描述。评论不表示人工审批，也不能代替真实交付。

评论使用独立属性 `gamecli.comment.<execution_id>` 保存投递状态，发送前持久化意图。响应丢失后分页查找对应执行编号，已存在则补记回执，尚未确认则停止重复发送；确定的字段/权限拒绝可在修复后重试评论，不重跑 Agent。JIRA 不可用时无法承诺即时写入；重连或再次调度会补齐已保存的终态结果评论。进程被强制结束但没有终态证据的运行记录仍需人工核对。

Development 只读验证使用 `orchestrator --development-probe --issue <主任务> --server <ws或wss地址>/ws --project <目录> --format json`，结果保存在程序子任务的 `gamecli.development-probe.v1` 和评论。它不编写代码、不生成资源、不伪造美术完成，不能解除生产审批/依赖。已有 ART 联调回执在再次运行 `--art-probe` 时补写评论，无需重复启动。

测试：构建并运行 `GameCLI.DeliverySmoke`；服务目录运行 `npm run test:watch`，覆盖真实 WebSocket 传输、美术审核前阻塞、审核后 Development/QA 串行启动、重连及重复事件防重、执行评论。测试中的 JIRA 与专业制作 Agent 是隔离替身，不表示真实生产资源已交付。

常驻命令每轮调度默认最多 600 秒，可通过 `--dispatch-timeout <1至3600秒>` 调整；`--timeout` 则控制整个监听命令的时长。单轮超时会取消所属代理并记录失败，不无限占用执行器。
