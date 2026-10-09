# 云端编排迁移说明

客户端 Orchestrator 插件、注册入口和专属技能已删除，旧本地调度命令不可调用。Unity 中 Monitor 只显示实际本地进程，不负责业务编排。

所有需求审批、依赖判断、任务分配、租约、重试及结果持久化统一归 GameCLIServer。GameCLI 仅作为执行端，与云端通信、启动授权角色的 Agent 并回传结果；通用 Codex 进程通信与 PM 只读分析保留。

当前正式云端派工尚未接通，不能把删除客户端编排描述为已完成云端闭环。实施依据见仓库 docs/gamecli-server-architecture.md 和 docs/GameAI协作平台技术开发纲要.html。
