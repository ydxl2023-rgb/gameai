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

## 全角色恢复（2026-10-20）

- `src/database/recovery-protocol.js`：六个固定角色 claim 时必加载的恢复协议及哈希；Design 阶段执行编号。
- `src/database/upstream-repairs.js`：有证据的直接上游缺陷交接，保持原任务/固定 Agent/冻结契约，交付后唤醒原下游复验。
- `src/track/role-job-recovery.js`：Design 确定性修订与已授权 PM 作业的停止核验、原结果发布恢复和有限续跑。
- `src/database/role-operation-claims.js`：拒绝过期或已替换 Design/PM 操作的迟到 claim。
- `src/track/recovery-watchdog.js`：独立巡检中断任务、孤立派发预约与丢失通知。
- `src/track/agent-stop-recovery.js`：核验原节点签名的失败停止凭据，恢复六角色占用；不授予迟到成功。
- `GameCLI/Services/CloudAgentRun.cs`：在所拥有 Codex 进程实际停止后保存签名凭据，离线时仍保留回报证据。
- `migrations/033_all_role_recovery.sql`：上游交接记录与 Design/PM 恢复历史；已应用迁移不修改。
- `test/all-role-recovery.test.js`：真实 PostgreSQL 故障演练，覆盖六角色停止、四专业角色恢复、嵌套上游失败、Design/PM 原作业续跑与人工暂停/撤权。

独立手工调用的首次 Design 草稿尚无服务端作业意图；它可以保存草稿检查点、恢复提交和回收停止占用，但不等同于服务器能自动重启该整条手工作业。未知进程无停止凭据、凭据失效、业务决定及没有匹配修复器的平台故障仍保留明确处理责任；不会把无限重跑写成自动修复。

## UI 资源用途命名（2026-10-21）

`src/database/ui-asset-naming.js` 为任务提供稳定用途名称；`asset-path-aliases.js` 按显式登记的 PNG/.meta 哈希与 GUID 解析历史路径。项目登记位于 app/client/ProjectSettings/UnityCliAssetAliases.json。UnityCLI 的 UnityCliAssetAliases 在原 guard 通过后解析导入及绑定路径；不改写审批或历史记录。UILogin 本次迁移15张PNG，证据见 deliveries/ui-readable-names-20261021/verification.json。

字体同样使用可读名称：从字体族/字重元数据命名（例如 MicrosoftYaHeiRegular.ttc、MicrosoftYaHeiBold.ttc），不能从文本控件名猜测字体族。路径兼容现支持 png、ttf、otf、ttc，并强制迁移前后扩展名相同。UILogin 两个字体的字节、meta 和 GUID 全部保留。
