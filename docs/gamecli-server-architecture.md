# GameCLIServer 平台服务

## 当前边界

Node.js + TypeScript 服务与 React / Ant Design Track 共用 PostgreSQL 业务存储。服务代码位于 app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLIServer。

旧第三方任务系统适配、通知中转、重放协议和 CLI 订阅调度已移除。当前服务只提供工作台、MCP 读取、原始 HTML 审阅和本机 Agent 配置；没有正式审批、任务发布或工作节点接单接口。

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
