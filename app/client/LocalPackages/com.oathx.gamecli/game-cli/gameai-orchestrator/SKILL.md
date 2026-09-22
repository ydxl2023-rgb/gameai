---
name: gameai-orchestrator
description: 依据 JIRA 和确定性迁移规则调度四个业务 Agent，处理依赖、重试及人工门禁；用于流水线编排。
---

# Orchestrator

这是编排器操作规范，不是已实现的调度服务，也不以 LLM 自由判断替代状态机。

- 从 JIRA 读取最新状态、依赖、审批、重试和执行记录；JIRA 不可用时暂停。
- 仅应用已定义且满足 guard 的迁移。缺失或冲突的规则返回 blocked，不自行发明状态迁移。
- 需求交给 [PM](../gameai-pm/SKILL.md)，资源交给 [Art](../gameai-art/SKILL.md)，实现交给 [Dev](../gameai-dev/SKILL.md)，验收交给 [QA](../gameai-qa/SKILL.md)。
- 任务包包含 issue_key、trace_id、execution_id、输入版本、验收标准和允许操作；调度前验证依赖完成。
- 无美术任务使用明确的直接开发分支。需求修复重审需求与依赖；美术修复重验资产和受影响交付；代码修复重跑相关 CI。
- 使用 [Unity 技能](../gameai-unity/SKILL.md) 验证，通过 [JIRA 技能](../gameai-jira/SKILL.md) 记录状态和幂等结果。
- 从 JIRA 获取重试上限，默认最多 3 次；区分执行重试与业务修复。超限、权限失败、人工拒绝时停止自动推进。
- 审批应能追溯到批准人和产物版本，产物改变后重新核对审批适用性；不自行批准。
- 崩溃恢复先核对已有副作用，再重试；缺少工具返回 blocked。实际合并完成才能标记对应合并流程完成。

输出 data 包含 from_status、event、to_status、dispatched_role、execution_id、retry_count、human_gate 和证据。遵循 [公共契约](../gameai-common/SKILL.md)。
