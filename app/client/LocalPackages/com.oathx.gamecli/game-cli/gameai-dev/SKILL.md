---
name: gameai-dev
description: 按 JIRA 需求实现或修复 Unity 功能并交付代码与验证证据；用于 Dev Agent。
---

# Dev Agent

本工具工程的 CLI 客户端、单机编排与 Unity 集成使用 C#，独立控制台工程目标为 .NET 8；Unity 集成代码使用目标 Unity 支持的 C#/.NET API。用户指定的 GameCLIServer 集中协调服务使用 Node.js。标准技能保留为 SKILL.md，不另建 Python 实现。

- 输入：JIRA 需求、验收标准、依赖、资产 URL/Hash、代码基线及 Unity 版本。
- 检查工作区已有修改、依赖和审批，核对资产 Hash，在授权范围内实现代码、Prefab、Scene 等。
- 编码前必须读取并严格执行 [GameCLI 编码规范](../gameai-cli-development/SKILL.md)，该规范强制适用于所有使用 GameCLI 的目标工程；目标项目规则可以补充但不得放宽，冲突按规范要求处理。保留 .meta GUID，分离 UnityEditor 与运行时代码。
- 交付前检查本次新增和修改代码的命名、排版、注释及通用实现约束；不符合规范时先修正，不以编译通过替代规范检查。
- 使用 [Unity 技能](../gameai-unity/SKILL.md) 编译与测试；修复依据实际日志和验收证据。
- 使用 [JIRA 技能](../gameai-jira/SKILL.md) 回写实际分支、Commit、PR 和报告。提交、推送、PR 按本次授权执行，不默认合并或发布。
- 重试由编排器按 JIRA 记录控制，不在 Agent 内无限重试。

输出 data 包含 branch、commit、pr_url、build_id、test_report、changes、remaining_issues。未执行步骤使用 null 并说明原因；编译通过不能替代功能验收。遵循 [公共契约](../gameai-common/SKILL.md)。

## 依赖与交付门禁

执行或编写专业任务时，必须遵守 [任务依赖与交付规范](../gameai-task-delivery/SKILL.md)。单据列出真实前置编号、启动条件、交付要求及确认方式；编排器验证上游完成状态、实际文件与版本后才派工，交付提交不等于审核完成。

## 只读启动联调

宿主明确指定 `development_probe` 时只确认任务接收、用中文返回后续计划，禁止编写代码、创建文件、运行工具或改动 JIRA；返回 `acknowledged=true`、`assets_generated=false` 及原样 issue_key/execution_id。它不是正式开发交付，不需要生产批准，也不能替代美术依赖与开发门禁。
