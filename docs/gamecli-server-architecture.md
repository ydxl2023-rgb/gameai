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

云端验证最新批准版本及原始 HTML 的字节哈希，创建 `pm_jobs` 持久执行记录，调用本机 Release GameCLI 的 `pm plan`。该命令在固定 PM 的对应需求会话中产生结构化计划，服务校验角色、必填交付标准、依赖完整性和无环后，在同一事务内创建 PM 主任务、美术与程序子任务、依赖及发布记录。验收用例写入各子任务，本阶段不创建 QA 子任务，不启动制作或开发。

重复点击返回同一作业；已成功版本禁止重复建单。明确失败可人工重试，总计最多三次。执行仍运行或结果未知时阻止再次启动；服务中断后未决作业到期显示待核实，不能自动重派，需核实原进程及固定 Agent 租约后处理。结果暂存 `.gamecli/pm-jobs/<execution_id>/`，数据库仍为唯一状态来源。正在拆分时 UI 每五秒刷新本服务快照。

当前仅支持固定 PM 绑定服务器所在本机工作站，尚未实现远程 Worker 通道。迁移后运行 `node --env-file=.env.database-admin scripts/setup-pm.mjs` 追加发布权限；构建 Release CLI 和 Track，更新技能后执行 `npm run db:sync-skills`。测试运行 `npm run test:pm`，数据库用例全程事务回滚，模型执行使用确定性输出替身。
## 统一任务短编号

Task、Parent 与依赖引用统一为角色字母加短横线、七位数字：Design `D`、Art `A`、Development `P`、QA `Q`、PM 主任务 `T`。由 `007_task_numbers.sql` 的数据库序列及插入触发器统一分配，零填充、允许间断、不循环。完整中文名称保留在 title。既有编号迁移时保存 legacy_task_key，所有 UUID 关系不变。

## 任务树与人工派发许可（已实现）

任务列表按 `parent_id` 展示目录树，主任务默认折叠，点击加号展开子任务；搜索与筛选保留祖先层级，分页以主任务为单位。专业子任务各有独立勾选框，默认不勾选，不提供主任务全选，也不会连带勾选依赖。

勾选通过本机人工会话与 CSRF 调用 `POST /api/track/review-task-selection`，提交任务 UUID、目标布尔值及选择版本。PostgreSQL 保存 `dispatch_allowed`、`dispatch_revision`、操作人和时间，并写审计；页面冲突时刷新，不覆盖另一操作。只能修改尚未执行的专业子任务；允许派发时再次核验最新批准需求与已发布计划。已有执行不能通过取消勾选中止。

勾选仅保存人工意愿，不创建执行或启动 Agent。未来编排器领取任务必须同时满足人工允许派发、需求审批和计划版本有效、实际依赖交付完成、产物有效、节点容量和执行租约等条件，并在同一原子领取中复核；未勾选不得派发。该步骤不代表自动派工已经接入。数据库迁移为 `008_task_dispatch_selection.sql`，迁移后执行 `scripts/setup-pm.mjs` 追加所需列更新权限。

任务树使用主任务 → 角色分类 → 具体任务三层展示。角色分类是前端虚拟目录，不入库、不改变 parent_id 或依赖关系；仅显示有任务的角色，按 Design、Art、Development、QA、PM 排列。分类统计当前展示的任务数、已完成数与依赖阻塞数，筛选时标注为筛选结果。分类没有派发勾选框，人工许可仍逐个保存在真实专业子任务上。搜索和筛选自动展开主任务及角色目录，任务编号与依赖跳转保持原样。
