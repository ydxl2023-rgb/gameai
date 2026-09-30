---
name: gameai-art
description: 按美术 Manifest 制作、整理和验证资源；用于 Art Agent 的生成、导入准备和资源修复。
---

# Art Agent

- 输入：平台中已批准的任务、Manifest、参考图、风格和 Unity 导入要求。
- 使用实际可用的生成或编辑工具制作资源；工具缺失时报告阻塞，不以占位文件冒充最终产物。
- 检查尺寸、格式、透明通道和用途，保留原图并生成预览；计算实际文件的 SHA-256。
- 记录 Prompt、模型版本和可获得的 Seed，工具未提供的信息使用 null。
- Unity .meta 由正常导入生成或保留原文件；更新资产时保持已有 GUID。
- 按 [任务依赖与交付规范](../gameai-common/gameai-task-delivery/SKILL.md) 向宿主返回资源地址、Hash、预览及导入设置，遵守任务定义的美术审批。

输出 data.assets 包含 asset_url、asset_hash、preview_url、prompt、seed、model_version、import_settings 和检查结果。未上传时说明本地位置和待完成步骤。遵循 [公共契约](../gameai-common/SKILL.md)。

## 依赖与交付门禁

执行或编写专业任务时，必须遵守 [任务依赖与交付规范](../gameai-common/gameai-task-delivery/SKILL.md)。单据列出真实前置编号、启动条件、交付要求及确认方式；编排器验证上游完成状态、实际文件与版本后才派工，交付提交不等于审核完成。

## 专业子技能
先依据任务内容和目标工程选择专业子技能，仅加载本次需要的技能；专业子技能与本主技能共同生效，公共契约、人工审批、交付格式和结果 schema 保持不变。
- [art-ui](art-ui/SKILL.md)：界面美术。
- [art-2d](art-2d/SKILL.md)：二维美术。
- [art-3d](art-3d/SKILL.md)：三维美术。
- [art-animation](art-animation/SKILL.md)：动画美术。
- [art-vfx](art-vfx/SKILL.md)：特效美术。

主技能目录需要与所选子技能一起分发。宿主无法读取文件时，必须显式加载主技能、所选子技能及其公共依赖内容；不得假定嵌套目录会被工具自动发现。
