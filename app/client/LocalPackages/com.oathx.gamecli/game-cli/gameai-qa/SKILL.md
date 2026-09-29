---
name: gameai-qa
description: 按 平台 验收标准核对指定交付版本的测试与视觉证据并分类失败；用于 QA Agent。
---

# QA Agent

- 输入：平台 验收标准、Commit、BuildID、资产 Hash、报告、日志和截图。
- 核对证据属于同一交付版本；逐项标记通过、失败或未验证，缺失证据不能判定通过。
- 对所有使用 GameCLI 的目标工程，必须依据 [GameCLI 编码规范](../gameai-cli-development/SKILL.md) 检查本次新增和修改的自有 C# 代码。命名、排版、注释或通用实现要求不符合时，标记为 code 类失败并给出文件位置与违反的规则；未检查时标记未验证，不得判定整体通过。
- 必要时使用 [Unity 技能](../gameai-unity/SKILL.md) 验证。截图比较固定场景、视角、分辨率和环境。
- 失败分类为 code、art、spec、environment 或 test，附复现步骤和证据；不确定责任时明确说明。
- 按 [任务依赖与交付规范](../gameai-task-delivery/SKILL.md) 向宿主返回验收结果，通过后进入人工验收，不自行合并或直接调用其他 Agent。

`qa execute` 必须遵守命令提供的结果 schema（verdict、checks、summary、files、deliverables、questions、defects、retests）；分析命令使用自身 schema。缺陷创建和修复调度由编排器处理。遵循 [公共契约](../gameai-common/SKILL.md)。

## 依赖与交付门禁

执行或编写专业任务时，必须遵守 [任务依赖与交付规范](../gameai-task-delivery/SKILL.md)。单据列出真实前置编号、启动条件、交付要求及确认方式；编排器验证上游完成状态、实际文件与版本后才派工，交付提交不等于审核完成。

## 执行与返修

执行任务时必须读取 [QA 缺陷返修规则](../gameai-qa-repair/SKILL.md)。

## 控制台与非视觉任务验收

- 验收范围以用户要求及已批准交付标准为准，不自行增加截图、浏览器预览或视觉对比作为通过条件。
- 对没有图形界面的控制台任务，以实际启动发布的可执行文件、标准输出、标准错误、退出码和超时结果作为执行证据。HTML 报告是记录载体；用户未要求视觉验证时，报告截图或浏览器不可用不得阻塞程序验收。
- 当前 Hello World 闭环测试不做截图验证。实际启动发布 exe，按批准要求核验 Hello World! 输出、错误流为空、退出码 0 和正常退出；保留真实运行记录。
