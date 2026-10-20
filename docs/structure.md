# 当前协调服务结构

权威架构和历史迁移见 [gamecli-server-architecture.md](gamecli-server-architecture.md)。

## 任务自动恢复

- `game-cli/src/GameAI.Server/src/database/task-repairs.js`：失败指纹、进展识别、持久化登记和诊断策略。
- `src/track/task-repair-flow.js`：租约领取、环境/依赖探测、宿主验证与原任务恢复许可。
- `src/track/task-preflight.js`：冻结附件精确 guard 与真实 Unity dry-run；不写资产。
- `migrations/032_task_repair_queue.sql`：PostgreSQL 恢复队列。
- `src/track/task-publication.js`：独立的结果发布和实际停止凭据恢复。
- `GameCLI/Services/UiLibrary/JsonValueEquality.cs` 与 `UiChangeGuard.cs`：精确数值语义与历史无效变更兼容。

生产执行只调用固定角色；通用平台代码自动生成与部署尚未实现。
