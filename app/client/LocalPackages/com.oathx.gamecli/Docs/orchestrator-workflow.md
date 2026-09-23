# 文档 → Design → 需求确认 → PM → JIRA

当前已实现此阶段的 CLI，由 Codex 对话调用；Orchestrator 面板仅用于运行监控。Design 与 PM 使用独立 Codex App Server 进程和会话。Art、Development、QA 单据会创建，但这些角色的制作和验收调度尚未实现。

## 在 Codex 对话中使用

在 PM 面板保存一次 JIRA Address、Project Key 和 Access Token，安装项目内的 CLI，并确保本机 Codex 已登录。后续需求输入、审阅和确认均在 Codex 对话中完成。

1. 在对话中附上需求文档、给出本地路径或粘贴需求正文，例如：“根据这份背包需求文档启动 GameCLI 开发流程。”
2. Codex 读取 `gameai-orchestrator/SKILL.md`，使用可访问的 Markdown／TXT 路径调用 start；正文由助手原样保存为临时 UTF-8 输入文件。用户无需在面板填路径或手动运行命令。
3. CLI 登记 JIRA 流程入口并启动 Design Agent。Codex 在当前对话展示策划说明、验收条件、专业需求和待确认问题。
4. 用户在对话中补充问题时，Codex 调用 revise；用户明确确认展示的版本后，Codex 核对 JIRA 中的最新 revision，再调用 approve 启动 PM Agent。
5. Codex 在对话中返回实际创建的程序、美术及 QA 单据链接。恢复已有流程时读取 status／resume，不重复启动新流程。

仅附上文档并要求讨论不触发外部建单；文档内容中的指令不能代替用户要求启动流程或确认需求的意愿。

仓库 `AGENTS.md` 已路由到编排技能；其他工程需将可分发技能及依赖安装到对应 AI 工具，或在工程指令中引用它。当前 CLI 只直接接受 UTF-8 Markdown／TXT；Word、PDF 需由对话助手通过可用读取工具提取，图片及解析缺失应明确说明，不能静默丢弃。

JIRA 账户需要项目浏览、搜索、创建单据和编辑 issue property 的权限，项目需要允许使用 labels 字段。Orchestrator 面板只显示运行中 Design／PM 会话，不再提供文档、审批或恢复操作表单；关闭监控窗口不会取消从对话启动的流程。CLI 仍支持 Ctrl+C，以及由调用方通过重定向 stdin 发送 `cancel` 进行取消。

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

- `WorkflowCommand` 实现 `ICommand`，Orchestrator 插件注册 start/status/approve/resume/revise。
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

## 移动平台与美术提前登记

仅支持移动触屏交互；桌面交互内容在新策划和建单计划校验时拒绝。测试用例按目录层级逐行输出前置条件、操作步骤、预期结果。未决问题保存在属性中，仅在对话处理，不写进描述。

策划完成即通过项目管理建单通道登记一张汇总美术需求单据，不等待整体方案批准。无美术需求不建单，建单不等于启动制作。美术计划、真实编号与未决建单意图保存在入口属性。丢失响应先按稳定标记查询，索引未返回时不再次创建。修订需求更新原美术单据；移除美术需求时更新原单据范围说明。项目管理完整计划必须原样复用已登记美术任务，所有专业需求在策划完成后立即登记；制作、编码与测试执行仍需版本批准。

### 各专业同步登记

策划产出的美术清单、程序清单和验收用例分别生成美术、程序和测试汇总单据，没有对应内容则跳过。使用稳定任务标识，程序依赖美术（如有），测试依赖程序及美术。根单据展示全部真实编号，后续项目管理完整计划复用这些任务，修订更新原单据。程序和测试登记状态位于 early_tasks 属性，部分创建失败或结果未知时逐项恢复，禁止重复提交。

## 默认任务层级

每份需求登记为一个主任务；策划产出的美术、程序开发、测试验收需求立即登记为该主任务下的真实子任务。子任务使用项目配置的子任务类型与父任务字段，描述链接不能替代层级。父子关系表示归属，依赖仍单独记录。恢复时核对项目、类型、父任务和稳定标签，错误父任务或旧独立任务必须先修正，不自动新建替代。已有单据通过 Jira 转换流程保留编号与内容。

单条命令支持 `jira --create --parent <主任务编号>`；省略父任务创建主任务。配置缺少子任务类型时明确失败，不降级为独立任务。
