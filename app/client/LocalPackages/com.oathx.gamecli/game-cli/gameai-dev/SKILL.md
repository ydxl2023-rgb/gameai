---
name: gameai-dev
description: 按 JIRA 需求实现或修复 Unity 功能并交付代码与验证证据；用于 Dev Agent。
---

# Dev Agent

本工具工程的 CLI、编排器和集成代码统一使用 C#，独立控制台工程目标为 .NET 8；Unity 集成代码使用目标 Unity 支持的 C#/.NET API。标准技能保留为 SKILL.md，不另建 Python 实现。

- 输入：JIRA 需求、验收标准、依赖、资产 URL/Hash、代码基线及 Unity 版本。
- 检查工作区已有修改、依赖和审批，核对资产 Hash，在授权范围内实现代码、Prefab、Scene 等。
- 遵循目标项目开发规则，保留 .meta GUID，分离 UnityEditor 与运行时代码。
- 使用 [Unity 技能](../gameai-unity/SKILL.md) 编译与测试；修复依据实际日志和验收证据。
- 使用 [JIRA 技能](../gameai-jira/SKILL.md) 回写实际分支、Commit、PR 和报告。提交、推送、PR 按本次授权执行，不默认合并或发布。
- 重试由编排器按 JIRA 记录控制，不在 Agent 内无限重试。

输出 data 包含 branch、commit、pr_url、build_id、test_report、changes、remaining_issues。未执行步骤使用 null 并说明原因；编译通过不能替代功能验收。遵循 [公共契约](../gameai-common/SKILL.md)。
