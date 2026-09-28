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
