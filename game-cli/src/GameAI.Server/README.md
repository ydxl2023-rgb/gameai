# GameCLIServer

Node.js + TypeScript 平台服务，提供 Track、MCP 读取、HTML 审阅和本机 Agent 配置。需要 Node.js 22.9.0 或更高版本。旧外部任务系统适配与通知协议已经移除。

Windows 使用 `start.bat`；自动安装缺失依赖、构建后启动服务，默认回环地址 8088。`start-track.bat` 启动 8090 的专用预览，可通过 GAMECLI_TRACK_PORT 覆盖。关闭窗口停止对应服务。命令行调用 `start.bat --no-pause` 可获取退出码而不暂停。

手动启动：`npm ci`、`npm run setup:track`、`npm start`。`.env` 配置 GAMECLI_HOST/GAMECLI_PORT，`.env.database` 保存数据库连接。Track 管理接口仍只接受本机请求，改监听地址不会开放远程管理。

有效入口：GET /health、GET /track、/mcp、GET /api/track/snapshot、GET /api/track/documents/:id，以及下文的 Agent 配置接口。没有外部 Webhook 或旧 WebSocket 订阅入口。HTTP 日志记录请求编号、方法、状态码与耗时，不记录请求正文、查询参数或令牌。

验证：`npm test`、`npm run test:track`、`npm run test:database`。本机人工审批已实现；任务发布及工作节点派工仍未实现，不能把配置 Agent 当作启动执行。

## Track PostgreSQL 数据存储

新 Track 使用独立 `gameai` 数据库和 `gameai` 模式，作为唯一业务存储。连接配置为服务目录下被 Git 忽略的 `.env.database`；迁移所有者配置为 `.env.database-admin`。服务账号只有 SELECT 权限。

- `npm run db:migrate`：事务迁移与校验和检查。
- `npm run db:seed`：显式导入测试数据，已存在则跳过。
- `npm run db:status`：检查实际数据库记录。
- `npm run test:database`：验证持久化与数据库约束，测试写操作回滚。

表结构、字段与后续边界见仓库 `docs/GameAI数据库设计与入库说明.html`。数据库模式不可用时直接报错；`GAMEAI_STORAGE=demo` 为显式离线演示模式。新服务已提供本机人工审批；派工和通用权限写接口尚未开放。

策划需求阅读必须关联原始 `.html` 文件，Track HTML 列直接打开原文，不用结构化节选代替。维护入口：`node --env-file=.env.database-admin scripts/database.mjs link-html <需求编号> <版本> <仓库相对HTML路径>`。仅允许 `app/desgin` 内 HTML；关联绑定需求版本与文件哈希，已批准版本拒绝更换原文，读取时核验原始字节。文档以隔离的静态 HTML 打开，不执行文档脚本。

## 手动配置 Agent

迁移 002 增加 Agent 名称、并发容量、幂等编号，以及 skills / agent_skills 两张表。先运行 npm run db:migrate 和 npm run db:sync-skills，同步角色主技能和辅助技能的 SHA-256。已绑定的技能版本不随目录同步自动改变。

当前在本机 HTTP 工作台的项目总览、Agent 分页提供“添加 Agent”。选择名称、角色、已有节点、匹配的主技能、辅助技能、容量和启用状态后保存。新配置在 Agent 分页查看；项目总览只显示实际执行中的实例。技能选择只授予项目读取，不自动授予任务写入或审批。仍未接通节点心跳、派工和启动执行。

本机开关 GAMEAI_LOCAL_AGENT_MANAGEMENT=true；.env.agent-manager 单独保存 PGUSER 和 PGPASSWORD，已被 Git 忽略。此账号需要 gameai 模式 USAGE、相关表 SELECT，以及 agents、agent_skills、agent_grants、audit_events 的 INSERT 和审计序列 USAGE；不授予审批表或任务表写权限。HTTP 写接口只接受回环请求、同源 Origin、JSON 和本服务发出的临时能力凭据；请求中不接受权限或人工角色。该模式不替代正式登录，不开放远程访问。MCP 内嵌实例仍只读，添加入口暂仅本机 HTTP 页面可用。

重复请求返回原 Agent，重复名称、无效节点、角色主技能不匹配、跨角色辅助技能、技能文件已改变和超出节点容量均拒绝。创建和审计在同一事务中提交。

## Design 文档与人工审批

迁移 004 增加原始 HTML 字节存储和人工账户密码哈希。先使用数据库所有者执行 db:migrate，再用维护管理员的 PG 环境运行 node scripts/setup-review.mjs。维护脚本创建独立受限 gameai_workflow 服务账号、Design 提交令牌与人工 reviewer 账户；重复运行保留既有本机凭据。配置 .env.workflow 与 .env.review-account 均已被忽略。不要向 Agent 发送人工账户密码。

- GameCLI design draft：实际运行独立 Design Agent；HTML 与可重试提交文件写入 app/desgin。
- GameCLI design submit：上传已有提交文件；从 GAMEAI_SUBMISSION_TOKEN 读取专用令牌，最多三次网络尝试，服务校验相同请求内容并复用结果。
- POST /api/track/requirements：专用提交凭据、最大 5MB 原始 HTML、SHA-256 校验；文档、需求版本、审计在同一事务保存，成功即待审批。不同内容不能覆盖已存在版本。
- GET /api/track/review-session，POST /api/track/review-login、review-logout：本机人工登录；密码使用加盐 scrypt，HttpOnly/SameSite cookie，有效期八小时，服务重启需重新登录。登录限速。
- POST /api/track/review-decisions：同源与 CSRF 校验、启用人工账户和项目审批权限、最新版本、文档哈希校验；同意或拒绝写入不可变审批及审计。拒绝原因必填，不允许覆盖决定。客户端提交的身份不作为权限依据。

页面顶部“审批人登录”，随后在需求审批打开 HTML，底部同意／拒绝及确认完成审批。只有实际上传的文档可以在本流程批准；旧本地关联资料保持只读。MCP 内嵌仍为只读，写操作当前只支持本机 HTTP 页面。已批准不触发 PM 或节点派工。

验证：npm run test:review；真实业务文档测试止于待审批，自动测试中的同意与拒绝全部使用事务回滚的独立测试项目。
