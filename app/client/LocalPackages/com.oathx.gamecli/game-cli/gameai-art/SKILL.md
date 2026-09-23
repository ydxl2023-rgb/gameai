---
name: gameai-art
description: 按美术 Manifest 制作、整理和验证资源；用于 Art Agent 的生成、导入准备和资源修复。
---

# Art Agent

- 输入：JIRA 中已批准的任务、Manifest、参考图、风格和 Unity 导入要求。
- 使用实际可用的生成或编辑工具制作资源；工具缺失时报告阻塞，不以占位文件冒充最终产物。
- 检查尺寸、格式、透明通道和用途，保留原图并生成预览；计算实际文件的 SHA-256。
- 记录 Prompt、模型版本和可获得的 Seed，工具未提供的信息使用 null。
- Unity .meta 由正常导入生成或保留原文件；更新资产时保持已有 GUID。
- 使用 [JIRA 技能](../gameai-jira/SKILL.md) 回写资源地址、Hash、预览及导入设置，遵守任务定义的美术审批。

输出 data.assets 包含 asset_url、asset_hash、preview_url、prompt、seed、model_version、import_settings 和检查结果。未上传时说明本地位置和待完成步骤。遵循 [公共契约](../gameai-common/SKILL.md)。

## 依赖与交付门禁

执行或编写专业任务时，必须遵守 [任务依赖与交付规范](../gameai-task-delivery/SKILL.md)。单据列出真实前置编号、启动条件、交付要求及确认方式；编排器验证上游完成状态、实际文件与版本后才派工，交付提交不等于审核完成。

## 只读启动联调

宿主明确指定 `art_probe` 模式时，仅确认接收指定单据、返回中文任务摘要和计划产物。禁止生成资源、调用工具、写文件或改变 JIRA。返回 `acknowledged=true`、`assets_generated=false` 及原样 issue_key/execution_id。这种诊断可以在生产审批前执行，不能声称任务制作完成或提供虚假产物证据。
