# GameCLIServer 平台服务

## 流程恢复更新（2026-10-19）

新专业任务在派发事务中登记 `task_publications`，保存精确执行输入。Agent 返回后先以原子文件替换保存输出，再写 PostgreSQL，之后校验并发布；缓存仅用于补交结果，不能授权任务。服务每十秒恢复未发布结果，数据库故障每三十秒重试发布，最多五次；不会因此再次调用 Agent。发布仍核验同一执行、输入哈希、当前审批、依赖和真实文件。延迟发布仅接受租约期间已经完成的执行凭据，不允许过期后继续执行。

新 PM 执行保存已校验计划到数据库，自动恢复原计划发布，最多五次；不重跑拆分、不恢复历史未启用恢复标记的失败。现有任务失败修复预算仍为三次，与发布重试分开。

PM 发布、专业任务结束、人工验收与 `workflow_outbox` 通知在同一事务提交。通知消费失败保留事件，重复消费由派发约束防重；原有周期性 active 流程扫描同时作为遗漏通知的兜底。通知只唤醒检查，不覆盖暂停或 Agent 授权。

执行结果新增 recovery.code：process_unconfirmed、awaiting_device、awaiting_dependency、awaiting_decision、awaiting_authorization、retry_exhausted、unclassified、task_repair。旧 Agent 文本仍采用保守分类，不因新增代码假定模型总能正确报告阻塞。人工暂停、审批修订、真机验收和未知进程不自动放行。

已验证：发布故障后复用结果、重复通知、提交后确认丢失、缓存补交、通知消费失败、租约过期保护，以及实际工作流账户的数据库事务与权限。尚不能自动恢复“Agent 已做副作用但没有返回任何结果”的未知执行；需要停止凭据和人工核实。源产物本身错误仍由原有有界修复机制处理。本轮没有启动新的生产或验收。

## 当前边界

Node.js + TypeScript 服务与 React / Ant Design Track 共用 PostgreSQL 业务存储。服务代码位于 game-cli/src/GameAI.CliServer。

旧第三方任务系统适配、通知中转、重放协议和 CLI 订阅调度已移除。当前已提供工作台、MCP 读取、原始 HTML 审阅、人工审批、本机固定 Agent 配置及手动 PM 任务发布；工作节点自动接单尚未接入。

## 唯一编排入口

客户端 Orchestrator 插件、专属技能与命令入口已经删除。GameCLI 只负责云端通信、授权任务执行、Agent 进程及结果回传；审批、依赖、租约、派工和重试全部由 GameCLIServer 决定。Unity Monitor 仅为本地进程监控。云端接口缺失时明确报错，不回退到本地调度。

## 后续实施

需求讨论 → 完整 HTML → 人工批准版本 → 校验文件存储 → PM 拆分 → 依赖就绪核验 → 获取租约 → 空闲节点启动代理 → 结果及评论入库 → 审核与验收。

HTTP 用于查询、文档、审批及结果提交；后续 WebSocket 用于工作节点注册、心跳、派工通知和取消。未来协议与旧通知协议无兼容承诺。业务写入通过平台服务，数据库约束、事务、幂等键和租约隔离代数共同保证恢复正确性。

完整技术路线以 GameAI协作平台技术开发纲要.html 为准。首版单项目、单调度实例，Unity 操控继续独立。

## 固定角色 Agent（已实现）

五个固定身份为 `design-01`、`pm-01`、`art-01`、`dev-01`、`qa-01`。初始化脚本 `GameCLIServer/scripts/setup-fixed-agents.mjs` 复用原配置，绑定当前机器，每个 Agent 容量为 1，节点容量为 5。配置存放于 PostgreSQL；本地 `.gamecli/client.json` 只保存连接参数并被 Git 忽略。

调用链：角色命令携带需求编号 → 云端核验固定身份、技能和容量 → 领取执行 → 按项目/需求/角色恢复或创建 Codex 会话 → 每 20 秒续约 → 回报完成或失败。90 秒未续约的执行视为待核实，继续占用容量，必须核实原进程后再人工恢复，不能直接重跑造成并行修改。固定身份不等于常驻模型进程；未运行显示“待启动”。

数据库新增 `fixed_agents`、`agent_conversations`、`agent_runs`。原 LOGIN-7 的已记录 Design 会话已绑定固定策划 Agent，修订继续使用该会话。看板显示固定标记、执行状态和当前需求编号。

每次执行均重新加载当前技能，并计算指令快照 SHA-256 写入执行诊断。恢复原会话时，除更新 `developerInstructions`，还在本轮输入中明确携带同一技能快照及其替代历史旧规则的约束，避免旧会话继续引用已失效规范；需求 HTML 与历史回复不作为技能覆盖来源。此机制不更换 Agent 或会话，也不改变人工审批门禁。CLI 的标准输入、标准输出和标准错误统一使用无 BOM 的 UTF-8，与服务端管道解码一致，特别覆盖直接返回中文 questions 的暂停分支。

命令入口：`design draft` 沿用现有参数；`pm --analyze` 新增必填 `--key`；`art analyze`、`development analyze`、`qa analyze` 使用 `--project <仓库> --key <需求编号> --prompt-file <文件>`。后三者当前仅只读分析，PM 仍返回拆分草案。设计上传校验固定 Design 已完成执行与需求/会话匹配；人工审批不变。云端自动排队、审批后 PM 自动发布任务、正式生产执行暂未实现。

初始化：在服务目录运行 `npm run db:migrate`，再运行 `node --env-file=.env.database-admin scripts/setup-fixed-agents.mjs`。脚本拒绝在活动执行期间重配，不提交 `.env*` 或 `.gamecli/client.json`。验证：`npm run test:agents`；测试使用事务回滚隔离真实业务。

## Agent 对话历史（已实现）

项目总览点击固定 Agent，在详情下方选择需求会话查看用户输入与 Agent 公开回复；长消息可展开完整原文，消息按原顺序分页。历史读取使用 Codex `thread/read` / `includeTurns`，不 resume、不发起 turn。数据库仅用于查询当前项目、Agent 与会话的明确关联，不开放任意 threadId 查询。

本机 HTTP 接口为 `/api/track/agent-history?agent=<编号>`；带 `conversation=<关联记录ID>&page=1` 读取消息。内嵌 UI 使用只读 MCP 工具 `gameai_agent_history`。响应排除 reasoning、系统指令和工具日志，网页按文本显示，不执行回复内 HTML。只显示已关联且当前服务账户可读取的记录，不等于所有历史 Codex 聊天；不同工作站暂不支持远程取历史，需后续 Worker 回传接入。当前对话面板只读，不提供发消息或修改策划入口。

## 手动 PM 拆分（已实现）

需求列表及原始文档底部提供“PM 拆分任务”。仅本机页面已登录且有审批权限的人工账户可以提交 `POST /api/track/review-pm-split`，携带 `version_id`、`revision`、`document_hash` 和 CSRF；Agent 提交令牌不能调用。已批准版本不会自动触发 PM。

云端验证最新批准版本及原始 HTML 的字节哈希，创建 `pm_jobs` 持久执行记录，调用本机 Release GameCLI 的 `pm plan`。该命令在固定 PM 的对应需求会话中产生结构化计划，服务校验角色、必填交付标准、依赖完整性和无环后，在同一事务内创建 PM 主任务、美术、程序与 QA 子任务、依赖及发布记录。验收用例写入各子任务，QA 依赖具体程序交付。发布不会立即启动执行。

重复点击返回同一作业；已成功版本禁止重复建单。明确失败可人工重试，总计最多三次。执行仍运行或结果未知时阻止再次启动；服务中断后未决作业到期显示待核实，不能自动重派，需核实原进程及固定 Agent 租约后处理。结果暂存 `.gamecli/pm-jobs/<execution_id>/`，数据库仍为唯一状态来源。正在拆分时 UI 每五秒刷新本服务快照。

当前仅支持固定 PM 绑定服务器所在本机工作站，尚未实现远程 Worker 通道。迁移后运行 `node --env-file=.env.database-admin scripts/setup-pm.mjs` 追加发布权限；构建 Release CLI 和 Track，更新技能后执行 `npm run db:sync-skills`。测试运行 `npm run test:pm`，数据库用例全程事务回滚，模型执行使用确定性输出替身。
## 统一任务短编号

Task、Parent 与依赖引用统一为角色字母加短横线、七位数字：Design `D`、Art `A`、Development `P`、QA `Q`、PM 主任务 `T`。由 `007_task_numbers.sql` 的数据库序列及插入触发器统一分配，零填充、允许间断、不循环。完整中文名称保留在 title。既有编号迁移时保存 legacy_task_key，所有 UUID 关系不变。

## 任务树与人工派发许可（已实现）

任务列表按 `parent_id` 展示目录树，主任务默认折叠，点击加号展开子任务；搜索与筛选保留祖先层级，分页以主任务为单位。专业子任务各有独立勾选框，默认不勾选，不提供主任务全选，也不会连带勾选依赖。

勾选通过本机人工会话与 CSRF 调用 `POST /api/track/review-task-selection`，提交任务 UUID、目标布尔值及选择版本。PostgreSQL 保存 `dispatch_allowed`、`dispatch_revision`、操作人和时间，并写审计；页面冲突时刷新，不覆盖另一操作。只能修改尚未执行的专业子任务；允许派发时再次核验最新批准需求与已发布计划。已有执行不能通过取消勾选中止。

勾选仅保存人工意愿，不创建执行或启动 Agent。编排器领取任务必须同时满足人工允许派发、需求审批和计划版本有效、实际依赖交付完成、产物有效、节点容量和执行租约等条件，并在同一原子领取中复核；未勾选不得派发。勾选本身不启动执行，派发及可选自动推进见后文。数据库迁移为 `008_task_dispatch_selection.sql`，迁移后执行 `scripts/setup-pm.mjs` 追加所需列更新权限。

任务树使用主任务 → 角色分类 → 具体任务三层展示。角色分类是前端虚拟目录，不入库、不改变 parent_id 或依赖关系；仅显示有任务的角色，按 Design、Art、Development、QA、PM 排列。分类统计当前展示的任务数、已完成数与依赖阻塞数，筛选时标注为筛选结果。分类没有派发勾选框，人工许可仍逐个保存在真实专业子任务上。搜索和筛选自动展开主任务及角色目录，任务编号与依赖跳转保持原样。

## 人工派发专业任务（已实现）

任务面板的“派发已勾选任务”和任务详情的“派发此任务”先调用 `POST /api/track/review-task-preview`，展示固定 Agent、可执行任务与阻塞原因。预览不写入执行。确认只提交预览中可执行的任务到 `review-task-dispatch`，服务重新校验人工会话、CSRF、勾选版本、最新批准需求、发布计划、依赖验收状态、交付文件哈希、固定角色、节点与权限。独立工作副本尚未接入，当前一个本机工作目录一次只执行一个专业任务，其余保留勾选；未开启自动推进时需再次人工派发，已开启时按后文完成事件继续调度。

云端使用项目锁与容量锁原子创建 `executions` 和 `task_dispatch_jobs`。GameCLI 的 `art execute`、`development execute`、`qa execute` 必须携带服务分配的 execution-id 和匹配输入哈希，通过固定 Agent claim 后才能使用 workspace-write；原 analyze 命令仍只读。节点当前仅支持服务器本机。运行过程沿用固定会话历史和心跳，页面每五秒刷新本服务执行状态。

执行结果保存在 executions.result，本机诊断位于 `.gamecli/task-jobs/<execution_id>/`。交付文件必须是项目内真实文件，服务计算 SHA256。正常执行先进入待验收，不直接 completed；存在阻塞、协议失败或产物缺失则失败。进程或完成凭据不明时保留 unknown 执行占用，不自动重派。20 分钟派发授权失效，迟到结果不能作为成功交付。当前尚无专业任务验收、未知执行核实和失败重试按钮，不能靠取消勾选解除占用；后续需单独实现这些人工操作。

部署执行 `npm run db:migrate`、`node --env-file=.env.database-admin scripts/setup-pm.mjs`、Release CLI 构建与 `npm run build:track`，按项目运行 `node --env-file=.env.database-admin scripts/setup-task-dispatch.mjs` 为固定 Art/Development/QA 配置仅限授权任务的权限，然后重启 Track 服务。相关数据库测试使用事务回滚和确定性 CLI 替身，不启动模型或修改真实业务任务。

## 同计划自动推进与宿主核验（当前规则）

人工派发确认窗口可开启“交付校验通过后自动推进”，授权范围仅限当前已批准计划中 dispatch_allowed=true 的专业任务。授权及原人工账户保存在 plan_dispatch_flows；完成事件直接触发编排器检查，不轮询外部系统。重启后恢复活动计划检查，不重复执行 assigned/running/unknown 记录。每次领取仍复核最新审批、权限、工作目录容量与上游文件哈希。没有前置的同计划已勾选任务也可执行，为其余依赖提供输入。

任务输入的 platform_context 由服务直接读取 PostgreSQL 生成，包含核验时间、版本与计划 ID。Agent 不读取数据库或平台凭据，不猜测 HTTP 端口；启动 claim 和结束复核仍由宿主执行，运行中连接由心跳维持。旧版本要求模型自行访问平台导致的阻塞，不应通过提供数据库密码解决。

结果必须含 verdict、checks、files：只有 pass、真实检查全部通过、证据路径包含在文件清单中、输入哈希一致、实际文件哈希有效、执行凭据有效、审批与上游未变化时才能放行。活动计划中的 Art/Development 标记工程交付 completed，编排器继续启动满足条件的已勾选任务；QA 保留 review，主任务在全部专业交付结束后进入最终验收。自动文件及证据校验不等同人工美术质量审核或实际游戏验收。

已确认停止、原 Agent 已获自动执行授权且失败属于任务内技术修复时，由原 Agent 在当前恢复周期内最多执行三次；包括模拟关闭按钮未命中、命中区域越界的诊断修复。修复不得改变冻结契约或降低验收标准，确需结构修订时仍须返回明确审批阻塞。未知失败、状态未知、明确审批或上游阻塞暂停计划；unknown 不允许重试。已暂停的历史计划不会因规则更新自行恢复。未启用自动推进的任务仍进入 review。每次结果保存执行记录、任务评论和审计。脚本与迁移：010_plan_dispatch_flows.sql；setup-pm.mjs 追加权限，db:sync-skills 同步角色技能哈希。此节替代上一节“只能下次人工派发”的默认限制，仅在明确开启自动推进时生效。

## QA 执行与原 Agent 返修（已实现）

PM 计划支持 QA 子任务；服务为未覆盖的程序任务补充 QA，保存具体程序依赖。现有发布计划可用 `node --env-file=.env.database-admin scripts/backfill-qa.mjs` 幂等补齐。补齐 QA 继承来源程序的允许派发选择，不恢复暂停的计划。

QA 领取依赖已完成的真实程序产物，在固定 QA 的需求会话执行。`pass` 表示真实检查通过并进入人工验收；`fail` 必须有可复现程序缺陷与实际证据；`blocked` 表示入口、工具、环境等不具备测试条件，仅暂停，不建缺陷。

缺陷在原主任务下创建新的 Development 返修任务，继续使用 P 加七位数字编号；`qa_defects` 保存来源开发任务、原执行、原开发 Agent、原 QA Agent、稳定 case_key、证据与轮次。相同 QA、来源任务和 case_key 只对应一个返修任务。返修继承 QA 的允许派发选择；仅在已开启的同计划自动推进中继续执行。原 Agent 不可用时等待，禁止改派新 Agent；会话继续沿用同需求的原会话。

修复交付后返修单处于待验收，缺陷处于待复测；原 QA 返回每个 defect_id 的复测结果，全部相关检查通过才能关闭对应缺陷，完成返修单。复测失败复用原单并更新证据，最多执行三轮修复，第三轮仍失败暂停等待人工处理。QA 最终通过仍需人工验收，不代表项目自动批准或发布。

未关闭缺陷阻止受影响的下游放行；已完成的受影响下游转为阻塞并需重验。原交付文件清单保持不变，后续按已成功修复的文件清单覆盖同路径版本；领取及结束均核验实际文件哈希、需求版本、租约和本轮输入。QA 的通过报告可以作为集成验收的前置证据。

任务详情显示原程序和 QA 的可点击编号、绑定 Agent、返修轮次及本轮问题。执行结果写入任务评论，关联和状态变化写入审计。规则见 `gameai-qa-repair/SKILL.md`。迁移 `011_qa_repair.sql` 后运行 `scripts/setup-pm.mjs` 与 `npm run db:sync-skills`。`npm run test:pm` 覆盖隔离回滚的 QA → 返修 → 复测、重复缺陷、原 Agent 身份、环境阻塞、三轮上限以及真实文件版本覆盖，不调用付费模型。

## 人工审批后自动推进（可选）

审批确认框默认不勾选自动执行。人工勾选后提交 `auto_start:true`，审批事务在 `approval_workflows` 中记录具体版本、修订、文档哈希和审批人；拒绝、未审批及代理提交均不能开启。既有审批不能通过重放请求扩大授权。

批准后服务从持久队列启动固定 PM。计划原子发布时只勾选本计划的专业子任务，登记活动调度流程，然后按依赖执行开发与 QA，返修遵守原 Agent 规则。未勾选则维持原手动流程。PM 失败会保留审批并显示自动流程暂停，不重复启动仍在运行或待核实的执行。重启恢复未领取队列，已领取但中断的 PM 需先核实原执行，不能盲目重放。

迁移 `012_approval_workflows.sql` 后运行 `scripts/setup-pm.mjs`。Hello World 试验使用独立源码目录 `app/samples/HelloWorld/` 和发布目录 `Artifacts/hello-world/publish/`，待审批通过后才由原开发链路创建并编译；QA 必须启动实际发布产物、检查输出和退出码。审批授权只适用于本需求，不恢复其他暂停计划。

## Track 工作流事件 Output

Output 展示 PostgreSQL 审计事件及关联执行结果，包含需求提交、审批、PM 拆分数量、派发、固定 Agent 开始与结束、交付校验、失败原因及返修。按事件 ID 去重排序，关联可读需求编号、任务编号与 Agent。只选择显示字段，不直接输出原始审计载荷或配置。

当前采用每 3 秒刷新项目快照的近实时方案，空闲时也继续刷新；同一页面请求不重叠。最近 500 条事件可在重载后恢复，支持筛选与跟随最新，详细交付证据按需展开；连接失败保留已有记录并重试。此窗口是执行状态日志，不是模型内部思考过程或终端逐字节输出流。后续可通过服务端事件推送替代快照轮询。

## 项目总览显示与技能添加

Agent 表格各列支持拖动及键盘调整列宽，并保存在浏览器本地；Skills 一项一行左对齐。工作状态按执行占用映射为“工作／空闲”，原始执行状态不变，异常、停用和离线仍保留提示。

本机配置管理 POST /api/track/agent-skills 仅追加已登记启用的辅助技能，保留原角色主技能及已有技能；沿用同源 capability 校验，不授予审批或任务执行权限。与 Agent claim 共享事务锁，运行或待核实时拒绝修改；重复提交幂等，下次执行读取更新后的技能。部署时运行 `node --env-file=.env.database-admin scripts/setup-agent-skills.mjs` 配置必要的执行状态只读权限。

后续优化见 [GameAI 后续优化清单](GameAI后续优化清单.html)，本轮没有执行清单中的验收、恢复或多节点改造。

## 所有数据列表统一列宽交互

项目总览、需求审批、任务与依赖、版本、人工权限、Agent 授权、操作记录及派发预览统一使用 `ResizableTable`。各表独立保存列宽，支持拖动与方向键、最小宽度和横向滚动，兼容旧项目总览与任务树的列宽设置。表格排序、筛选及树形展开维持原行为。后续新增同类列表必须复用此组件；界面测试检查不得绕过该组件直接新增 Table。

## Agent 授权中的自动执行

权限页的 Auto 列允许有人工审批权限的已登录用户，为固定 PM、Art、Development、QA 分别设置自动执行，默认全部关闭。Design 的需求产生仍由聊天输入驱动，不能自行审批。设置写入 PostgreSQL，使用同源会话、CSRF 和配置版本检查，变更写入 Output 审计事件。

审批新版本时固定当时启用的自动 Agent 身份与角色：PM 自动则创建 queued 作业并在审批提交后自动启动拆分；PM 手动而专业角色自动时保留 manual_pm，等待人工点击拆分。PM 完成后原子创建主子任务、依赖和自动推进范围，仅对应自动角色的子任务被自动选中。节点、容量、技能、权限、版本、依赖、产物和执行租约仍必须通过检查。建单后编排器按完成事件推进，QA 通过保留人工最终验收。

配置对之后批准的版本生效，不会扫描历史未授权需求批量建单。重复审批保留原授权快照。关闭角色自动选项不取消运行中任务，但按角色策略推进时禁止新领取；再次开启只恢复原版本已授权范围。其他手动任务仍可人工派发。审批窗口原有“本版本全部自动”和人工派发时明确选择自动推进，属于单次版本或计划授权覆盖，保留原行为。

迁移：013_agent_automation.sql；迁移后运行 scripts/setup-pm.mjs 追加自动配置列更新权限。回滚测试覆盖权限、配置冲突、审批快照、部分角色自动、手动 PM 发布与自动领取门禁。

## 批准文档执行副本

PM 和专业任务启动前，服务读取并核验数据库中的批准原文，保存至 app/desgin/approved/<版本ID>-<SHA256>.html。该文件仅为执行副本，数据库仍是唯一业务来源。输入明确提供实际相对路径、版本和哈希，覆盖正文里的预期文档文件名。专业任务在计算授权输入哈希之前准备文档，启动 CLI 前再次验证。文件缺失、被篡改或越出工程时停止，不启动 Agent，不伪造成功。已有失败任务需通过正常重试派发获取新输入，不能篡改历史执行记录。

## 内嵌需求原文与人工登录入口

Codex MCP UI 通过只读 gameai_track_snapshot 的 document_version 参数读取当前项目关联的原始 HTML，由服务校验文档关联及哈希。内嵌页面使用 sandbox 的 srcDoc 显示原文，读取失败展示错误，不向宿主域发起相对 HTTP 请求。

内嵌面板保持人工审批只读，通过“审批人登录”按钮及宿主 ui/open-link 打开本机 Track 登录页面；账户登录和审批仍使用该页面的人工会话与 CSRF。内嵌页面不持有账户密码或审批令牌。HTTP 页面继续保留原有登录与审批流程。


## 单 PM 与专业规则模块

仅 RodFergusson 执行拆分。pm/RodFergusson/SKILL.md 引用 ui、art、program 三个独立模块；当前只加载 ui/art，同一次执行读取完整批准 HTML，统一规划依赖与建单。按独立窗口生成白模 Prefab → 图片资源包 Art → 最终装配 Prefab，不按普通控件拆分，不生成程序或 QA 任务。发布仍校验审批、版本和无环依赖。旧 pm_stages 表仅保留历史，不再创建阶段或调度专业 PM。

## UI 确定性拆分第一阶段（2026-10-10）

本节优先于上述历史 PM 描述。startPmJob 在创建作业前校验批准 HTML 内唯一 ui-delivery-manifest v1；dispatchPmJob 保存 skeleton.json 并提供完整原文给单 PM。RodFergusson 仅补充标题、说明及六项验收内容，不能改变任务身份、角色、来源、依赖。publishPmPlan 在事务中从数据库批准原文重建骨架再次核验，不接受调用者用 scope 绕过验证。

每独立窗口固定 WHITEBOX/ART/ASSEMBLY 三项；内部区域和控件不拆单，不生成 Development/QA。跨窗口资源复用显式给 assembly 加 owner-ART 前置。tasks.logical_id/window_id/delivery_phase 保存稳定逻辑身份，与数据库公开编号分别管理。三阶段任务都生成完整窗口原始 HTML 附件，沿用人工审批和各 Agent 自动授权。

校验入口：src/database/ui-delivery-plan.js。测试：test/ui-delivery-plan.test.js、test/pm-plans.test.js、test/prefab-task-document.test.js。新迁移 018_ui_delivery_identity.sql 与 019_ui_delivery_identity_required.sql 只加字段/约束，不改历史业务数据。旧文档没有清单明确阻塞；任意自然语言与线框语义一致性仍需 Design/PM 审查。执行快照离线重放及计划哈希幂等属于第二、三阶段，尚未完成。

## PM 退回需求修订

PM 用 ready / revision_required / needs_input / execution_error 分类报告。服务器持久化 requirement_revisions，把明确文档矛盾排队交回原 Design；每条记录保存问题、证据、轮次、新旧版本、幂等提交。最多两轮，重复问题及待决策项转人工；运行结果未知时不重复启动。生成稿通过清单校验且窗口骨架未变后，原子写入新需求版本与待审批状态，不复制审批。人工批准新版本后，原有 PM 授权配置决定自动或手动拆分。旧版本审批和 HTML 始终保留。角色绑定改变时不静默转派。

## 永久协作记录（只读第一版）

操作记录后的协作记录页以聊天气泡展示公开流程事件，通过 HTTP 或 MCP 只读查询，三秒刷新并按游标加载历史。消息由 audit_events 插入触发器在原业务事务内保存到 collaboration_messages，来源事件唯一，历史不可更新或删除；不复制模型思考、提示词或原始 JSON。记录保存角色名称、需求标题及版本、任务编号快照，不外键依赖可清空的业务对象。普通测试清空保留协作记录，关联对象不存在时仅展示历史。已有审计事件一次性回填，不伪造对话。读取按当前项目隔离，支持角色与需求/任务搜索；首版没有发送、审批或派工输入入口。


## Design / PM 公共契约整理（2026-10-12）

公共 UI 规则唯一维护于 `game-cli/skills/common/gameai-ui-delivery-contract/SKILL.md`（规则版本 2.0.0）。文档格式入口引用它；Design 显式加载它；固定 Agent 的技能依赖解析也会加载它。Design 编写及自检，PM 补全固定骨架，UI/Art 只是 PM 的内部工作模块，不重新定义公共格式或任务粒度。Prefab 从同一契约读取命名约束。

平台规则矛盾用 CONTRACT_CONFLICT，经 PM 现有 execution_error 返回，不触发 Design 自动修订；正文错误用 DOCUMENT_INVALID，经 revision_required 返回；业务缺口用 BUSINESS_UNDECIDED，经 needs_input 返回。Design 仍使用现有 questions 文本通道带分类前缀，不改变外层严格 schema。

此次完成技能单一来源与加载接线，没有实现每文档契约快照持久化。后续版本锁定应在文档生成时由宿主保存 contract_version、原文快照和哈希，绑定需求版本；PM/修订读取绑定快照，迁移另建待审批版本。不能将当前执行指令哈希误称为文档契约锁定，也不能直接向既有严格 manifest 添加字段。现有提交校验继续检查 v1/v2 结构、引用与骨架；可见计数自动生成与全文语义比对须另行实现和验证。


## UI 模板库提取与入库首版（2026-10-13）

Unity CLI `prefab export` 在原工程只读导出。GameCLI `ui-library validate/import` 是现有插件宿主下的 C# 命令，通过结构化进程参数调用 GameAI.Server 的 `scripts/ui-library.mjs` 本机维护适配器；此入口不引入任务编排，不是远程上传 API。验证和 PostgreSQL 事务位于 `src/ui-library/library.js`。独立 `ui_library` schema 的 migrations 024/025 保留来源、不可变布局版本、依赖和导入记录，不属于 Track 业务清理范围。

当前标准序列化属性快照不等于跨版本逻辑属性适配器。嵌套覆盖、纹理/动画/特效依赖和源自定义组件存在缺项时返回 reference-only；禁止自动当作可重建模板。使用方式与真实验证范围见《GameAI-UI布局与视觉表现模板库开发纲要.html》第12章。


### 多项目离线UI目录采集

GameCLI `ui-library export --input <目录或prefab> --output <空目录> --source-key <来源编号> [--limit N]` 在 C# 内使用 YamlDotNet 读取源工程文本资产与 .meta，无需打开或安装源工程 Unity CLI。来源 Assets/Packages/LocalPackages 的 GUID 索引隔离，自定义脚本不执行。嵌套层级按实例前缀展开，资源版本引用保持，未支持的结构变化显式诊断；失败批次不能直接入库。当前 Unity 承担后续重建验证，不充当源工程宿主。具体范围见 UI 模板库纲要第13章。

### UI 模板附件与模型输入传输（2026-10-15）

完整模板依据通过 HTML 中的 `ui-template-context` JSON 数据块随版本入库；schema_version=1，payload 配合 SHA-256 校验。提交验证数据块，修订保留原附件且拒绝悄悄替换，独立预制任务 HTML 继承原附件。它不扩展 ui-delivery-manifest，也不改变人工批准的内容哈希。

PM 与 Design 修订输入使用 `ui-document-prompt.js` 的无损对象去重表示：重复 JSON 对象写入 definitions，data 内以 $contextRef 引用。所有字段可完整还原，不以摘要替代组件、动画或授权变更。数据库与交付 HTML 仍保留原始数据。该方式减少重复内容，不承诺任意大小文档都能进入模型上下文；进一步超限仍须显式报错，不截断正文。GameCLI 对结构化 input_too_large 错误显示实际字符数与上限，避免误报登录失败或超时。

UI 模板授权附件提交增加 guardBaselineJson 配对校验：原始提取 sourceSnapshot 仅用于溯源，不能代替授权差异清单使用的适配基线。存在 authorizedChanges 时，必须提供其 sourceSha256 对应的完整 UTF-8 基线文本，提交阶段拒绝缺失或哈希不符。完整差异仍由 GameCLI guard 校验；历史已批准文档的补充基线须保留原授权与目标哈希、实际 guard 证据及审计记录，不修改旧批准文件。


### Workflow recovery pump (2026-10-15)

Track initializes recovery at server startup and polls approved queued workflows, active task flows and requirement revisions every 10 seconds. Each lane is single-flight so a slow Agent does not block the other lanes. Database dispatch locks and current authorization/version checks remain authoritative. Paused flows and unknown executions are not blindly restarted; retries retain their three-attempt limit and single-use manual exceptions. UI snapshot whitebox production uses UnityCLI `prefab restore --whitebox` with the same immutable guard input, emits deferred external bindings, and never treats whitebox completion as final visual validation.


### Explicit repair cycles

A human single-task retry may set `recovery_cycle: true`. The server records an immutable cycle ID, prior lifetime attempt count and requesting user in task_dispatch_jobs.context and an audit event. Automatic retries inherit this cycle; they cannot create one. The new cycle permits at most three executions while retaining all historical attempts. Existing single-use retry_override retains its exact-count guard and does not itself grant a cycle. Current Agent automation, plan policy, approval, dependency and uncertain-process guards still apply. Specialist execution has an explicit 1800-second deadline and a 32-minute parent watchdog; timeout errors are classified distinctly and continuations reuse existing work.


Tool-enabled specialist prompts retain visible approved HTML but reference the immutable on-disk `ui-template-context` by approved document path and SHA-256. They do not repeat packed snapshots in the prompt. The file remains complete and is verified before execution; agents parse selected fields or pass complete files to tools rather than printing entire JSON payloads. PM/Design inline transport remains unchanged. This avoids exhausting model context without deleting production data.


## UI production contract task entry (2026-10-16)

`GameCLI task contract validate/register` and `task plan validate/submit` use the trusted local GameAI.Server adapter. PostgreSQL migration 028 stores approved immutable contracts, idempotent plan requests and frozen per-task inputs. The production contract must match the inert JSON block in the latest approved HTML. The server derives the three UI phases and their edges, publishes atomically under the project lock, and retains existing dispatch authorization. Specialist input includes the pinned contract and a server-written `production-input.json`. Legacy PM publication is not automatically migrated. This task-input envelope is not a Unity assembly package; resource resolution and downstream Unity validation remain separate. See `GameCLI-UI任务契约与建单.html` for commands and limitations.


### UI 契约建单入口统一（2026-10-16）
PM start 要求批准 HTML 含 ui-production-contract；publish 在同一数据库事务中登记契约、创建主任务并调用 submitTaskPlan，保存每条任务冻结输入。旧文本任务插入循环已移除，Prefab/Art 无契约禁止派发。CLI 独立提交仍要求已有主任务；正常 PM 发布负责创建主任务。旧批准文档必须补齐契约并重新审批，不能假装自动迁移成功。


### Design 到 PM 的契约链（2026-10-16）
GameCLI design draft 需要 --project-id；输出 windowsJson 后由服务端纯函数生成 ui-production-contract/1，再调用固定 Design 做独立自检，失败最多修订两轮。自检收据绑定完整文档哈希、契约哈希及真实执行会话；需求提交用契约预分配 UUID 入库，审批重新校验。PM 从生产契约直接推导三阶段骨架，原 ui-delivery-manifest 不再参与新建单。发布共用事务保存主任务、契约、冻结输入、依赖，保持权限独立。提交前的自然语言到结构化规格仍由 Design 推理，组件 properties 与动态 specification 尚非全量 Unity 语义校验；不得声称已实现通用模板无损转换或 Unity 最终装配。

模板迁移时可用 `design draft --window-spec <完整窗口数组.json> --source-document <来源HTML>`：宿主一次读取窗口候选，生成与复核消费同一份内存数据；Design 无需重新抄写完整节点。`--draft-file <结构化初稿.json>` 可恢复已生成正文，但仍必须重新编译并执行真实固定 Design 自检，不能复用旧通过收据。授权变更的配对基线在编译时提前核验。审查传输对重复对象去重；原始基线字符串保留在正式 HTML，模型收到全部解析值和原始字节哈希，省去转义及空白开销。上述入口均不替代人工审批。

### PM 大文档传输（2026-10-16）
PM 派发使用经过哈希校验的批准 HTML 文件引用传递大型 `ui-template-context` 附件，正文、生产契约和三阶段骨架继续内联。固定 PM 以只读工具按节点、资源或绑定类别读取附件，禁止整文件输出到模型上下文；读取失败按执行故障返回，不退回 Design 改需求。原始数据库 HTML、审批哈希和发布事务不变；不截断数据，也不提高传输硬上限。


### 需求规则冻结与外部等待（2026-10-19）

新需求提交在同一事务中写入 `requirement_rule_snapshots`，保存角色指令及项目规则，摘要进入需求内容哈希和人工审批。PM/任务领取读取所属需求版本快照并校验摘要；历史未绑定版本继续旧路径，不伪造历史快照。Design 新版本编写仍使用当前规则，提交时冻结。角色启停、权限与执行容量仍实时检查，快照不授予权限。

Track 将已确认失败执行中的外部等待原因映射为等待设备、等待审批、等待上游、等待工具、等待授权；保留原执行证据，不把等待变成自动技术重试。人工“重新检查”仍调用原重试入口，重新验证依赖、批准与权限。历史失败不得覆盖后来待验收/完成状态。

## 同一装配任务的人工授权增补（已实现）

`authorizeTaskAmendment` 为已失败的 Prefab 最终装配保存独立 `task_edits` 修订，不修改原 `ui_task_contracts` 输入、旧 HTML 或旧审批。当前仅支持精确父容器位置、Image 射线目标及 Canvas 新增 GraphicRaycaster，必须有原输入哈希、逐字段旧值、实际人工授权来源、证据目录及有效模拟屏幕安全区；不能用于任意删改节点或降低验收检查。

授权事务核对项目人工审批权限、最新批准需求、已发布计划、活动/未知执行及已执行下游，使用与派发一致的锁，撤销旧派发许可。`readTaskInput` 按修订顺序组合有效目标并重新计算哈希；派发及结束复核使用同一结果。旧历史保持可追溯。失败任务在无活动租约时可重新选择派发，但三次上限、原 Agent 和输入核验仍然有效。

服务端维护入口 `scripts/amend-task.mjs <task-key> <human-subject> <reviewed-amendment.json>` 只记录授权，不执行任务；`scripts/resume-amended-task.mjs <task-key> <human-subject>` 仅续接指定原任务，使用正式 dispatchTasks/runTaskDispatch 和 acceptTask，不创建替代任务，不生成虚假 Agent 凭据。调用验收入口必须已有本轮人工完成授权，且仅对正式成功交付、文件哈希有效及无未关闭缺陷的任务放行。该入口没有前端增补编辑器。

测试项目重跑使用 `scripts/rerun-test-project.mjs <project-key> <requirement-key> <human-subject>`，仅接受 is_test 项目，保留最新已批准需求、配置及永久审计。先读取并保存已授权最小装配增补，再清除任务/计划/执行状态，从固定 PM 重新拆分；为同窗口新装配任务重新核对增补旧值后登记，然后按正式依赖链执行。新任务使用新编号。原增补现在也允许在尚未执行的 pending/blocked 装配任务上登记，活动或未知执行仍禁止。

`clearProjectTasks` 的 clearCollaboration 选项通过 tasks.cleared 审计事件保存协作消息序号边界，readCollaboration 仅返回边界后的新一轮消息，包括分页；底层协作与审计仍保持 append-only。默认清空行为保持原有历史可见性。重跑不删除 Unity 资产或旧交付文件，避免破坏依赖来源及 .meta GUID；业务流程状态仍唯一保存在 PostgreSQL。

重新审批修订使用正式 Design draft 的 --window-spec 确定性继承原生产窗口，再应用已批准最小修复，避免遗漏 resourceSlots 的真实 artifactId/sha256。--review-prompt-file 可单独提供完整的业务审查依据；编译文档已携带全部目标、来源附件及哈希，不再将同一附件复制到原始需求段。此参数不跳过独立 Design 自检或正式人工审批。

prepareUiDocumentPrompt 对 guard 封装的嵌套 JSON 字符串使用完整解析值与原始字节哈希进行无损传输，再按对象键序无关的语义去重；数组顺序、节点属性、授权差异与引用仍保留，正式 HTML 中原始 JSON 字符串不变。prepare-reapproval.mjs 只生成并提交新版本到待人工审批，绝不写入最终批准或自动派工。


## 持久化任务诊断与恢复（2026-10-20，已实现）

服务端 task_repairs 表按失败 execution_id 保存诊断状态、冻结范围指纹、实际制作产物进展、探测次数、下一次探测时间和租约。失败后先保存结果，再登记恢复事项；不依赖进程内调用栈。启动与每十秒恢复泵包含独立 repairs 通道。数据库原子租约一次领取一个事项；租约过期后可接续。ready 是针对原失败执行的一次派发许可，不是批准新范围。正式派发仍核对最新审批、原角色、当前自动执行许可、依赖、工作目录占用和三次执行上限。

已实现的恢复路径：任务内技术修复；未知失败的一次原角色诊断；Unity 桥接指数退避探测；上游交付条件探测；冻结 UI 附件通过 GameCLI guard 与真实 Unity restore whitebox dry-run 的宿主复核。宿主复核保存不可变源/目标/批准哈希和真实执行侧凭据，不修改旧批准文档。恢复复用原任务编号和有效产物，失败上下文要求先复现、说明修改，再重跑受影响检查及最终验收。

相同冻结范围和失败检查再次出现且实际 Assets 产物哈希没有改变时，进入 no_progress；新提示词和新增报告不构成进展。未知错误不能无限重试。没有匹配的修复器、达到执行上限、缺少授权或确实需要需求决定时，保存 attention 原因并登记审计，不能宣称任意平台代码缺陷均可自动修复。后续扩展必须为具体错误增加可验证处理器，不能把生产 Agent 升权为数据库或平台维护者。

结果发布恢复另外识别 unknown 执行的实际 agent_runs 停止凭据；原进程仍在运行或结果不明时禁止重开。确认停止后，用原结果重新结束核验，可转入修复队列。宿主在调用 Agent 前的预检失败单独记录 pre_execution，不制造虚假进程凭据，也不会永久占用未知执行容量。

专业结果新增兼容字段 failure（成功为 null）：code、step、evidence_path、repair。新 CLI schema 要求明确填写；服务端兼容旧结果，并校验失败证据位于 files 中。错误码包括 ENVIRONMENT_UNAVAILABLE、CONTRACT_CONFLICT、TASK_VALIDATION_FAILED、UPSTREAM_INVALID、DECISION_REQUIRED、TOOL_FAILURE、UNKNOWN_FAILURE。旧文本分类仅作兼容。

数值校验按精确 JSON 数值语义比较，指数写法不产生坐标差异，不通过 double 舍入授权大整数。历史批准中的无效变更项仅在源和目标的该路径都存在、两边值与批准精确一致时兼容忽略；批准原文及其哈希不重写。Unity 适配器对不能精确表示的数值明确拒绝，防止精度丢失放行。

维护入口 scripts/recover-task.mjs <existing-task-key> [--enqueue-only] 仅将原自动执行授权仍有效、实际停止且失败的既有任务接入恢复；不新建任务、不重置执行次数、不代替审批。运行前应用迁移 032、更新 workflow 权限、构建 Release CLI 与 Track，并让 Unity 编译新适配器。验收包括跨实际 guard 实现的数值回归、PostgreSQL 租约恢复/并发/权限撤销/环境等待/无进展测试，以及正式 PM 派工链中的故障注入。


### 已验证工具修复的恢复预算与资源投影

默认三次生产执行预算保持不变。已确认的宿主工具缺陷可以在真实双侧预检通过后，按新工具二进制与Unity适配器源码的SHA-256开启一次新的三次预算；同一任务、同一工具指纹只能开启一次，累计最多九次。verified_repair_budget 仅由服务写入任务租约上下文，不能从Agent结果或请求参数传入，不删除原执行记录或重置总计数。达到预算或累计上限后明确记录待处理原因。

部署新工具后，恢复泵识别持久化attention中适用的工具缺陷，核对当前任务、人工自动执行授权和原暂停原因；只有工具指纹变化才重新诊断。重新诊断不等于重跑生产，实际readonly预检成功并保存凭据之后才放行原任务。普通依赖等待不能只依据“上游已完成”重试：结构化UPSTREAM_INVALID要求依赖交付版本实际改变，或由匹配的宿主处理器验证具体问题已解除。

GameCLI ui-library guard --manifest <已验收Art的ui-template/1快照> 是明确的执行适配选项，只能与 --approval 一起使用。保留原baselineJson、snapshotJson、approvalJson和各自哈希；另附resourceManifestJson及其哈希。两侧guard均要求全部实际节点、组件、属性、根信息完全相同，所选贴图逐项与原批准记录一致，不能增加/修改贴图或漏掉任何实际绑定。已展开实例的导出provenance不改变扁平节点；实际装配仍消费原节点表。服务端另按冻结resourceSlots核对复用来源哈希、数量、交付尺寸和已验收Art文件哈希，确保历史未绑定清单不是新增生产要求。

最终装配预检使用非whitebox restore --dry-run，确认没有延后绑定且资源完整；白模或Art阶段使用白模预检。实际执行输入目录中的execution-preflight.json提供本轮验证后的assemblyPath，生产Agent读取此封装并继续原阶段全部验收。预检本身不写资产，也不代替最终触屏、动画、四态截图和安全区检查。
