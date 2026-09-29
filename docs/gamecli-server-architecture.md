# GameCLIServer 平台服务

## 当前边界

Node.js + TypeScript 服务与 React / Ant Design Track 共用 PostgreSQL 业务存储。服务代码位于 app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLIServer。

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

失败或状态未知暂停该计划，不自动重试。人工对失败任务重新派发时最多三次，unknown 不允许重试。未启用自动推进的任务仍进入 review。每次结果保存执行记录、任务评论和审计。脚本与迁移：010_plan_dispatch_flows.sql；setup-pm.mjs 追加权限，db:sync-skills 同步角色技能哈希。此节替代上一节“只能下次人工派发”的默认限制，仅在明确开启自动推进时生效。

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
