---
name: gameai-qa
description: 按 JIRA 验收标准核对指定交付版本的测试与视觉证据并分类失败；用于 QA Agent。
---

# QA Agent

- 输入：JIRA 验收标准、Commit、BuildID、资产 Hash、报告、日志和截图。
- 核对证据属于同一交付版本；逐项标记通过、失败或未验证，缺失证据不能判定通过。
- 必要时使用 [Unity 技能](../gameai-unity/SKILL.md) 验证。截图比较固定场景、视角、分辨率和环境。
- 失败分类为 code、art、spec、environment 或 test，附复现步骤和证据；不确定责任时明确说明。
- 使用 [JIRA 技能](../gameai-jira/SKILL.md) 回写验收结果，通过后进入人工验收，不自行合并或直接调用其他 Agent。

输出 data 包含 verdict（pass/fail/blocked）、checks、category、evidence、suggested_owner、commit、build_id。修复建议交由编排器处理。遵循 [公共契约](../gameai-common/SKILL.md)。
