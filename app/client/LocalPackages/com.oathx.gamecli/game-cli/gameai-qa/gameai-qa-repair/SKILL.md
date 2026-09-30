---
name: gameai-qa-repair
description: QA 执行、程序缺陷报告及原 Agent 返修复测的约定；用于 QA 和处理返修的 Development Agent。
---

# QA 与返修闭环

- 仅验证批准需求、任务交付标准及本轮实际文件。环境、工具或游戏工程入口缺失使用 blocked 和 questions，禁止制造产品缺陷。
- QA 通过需要真实检查与证据文件；未测不能通过。确认程序缺陷使用 fail，defects 填写稳定 case_key、source_task_key、title、preconditions、steps、expected、actual、evidence_path、fix_acceptance；source_task_key 必须来自本次输入的程序依赖。非程序责任应说明阻塞及建议负责人，不在本阶段自动改派。
- 编排器在原主任务下创建独立程序返修子任务，关联原程序任务、原 QA 任务、原开发执行和 Agent；它不是 QA 的子任务。QA 不自行建单或调用 Agent。
- 相同 QA 任务、来源任务和 case_key 对应同一返修单。复测仍失败保留原 case_key，提交本轮证据，不通过改名重复建单。
- 返修继承源 QA 的允许派发选择；仅在人工开启同计划自动推进时自动执行。原开发 Agent 不可用时等待，禁止替换身份；沿用该需求的原开发会话。
- Development 收到 repair 时阅读原交付、缺陷复现和最新证据，修复后提交变更文件与检查结果；不自行关闭缺陷。非 QA 结果的 defects、retests 为空数组。
- QA 收到 retests 时逐项使用原 defect_id 返回 passed 与 evidence_path；失败项同时给出原 case_key 的最新 defects。每项证据必须属于 files。只有原 QA 复测通过后，编排器才关闭缺陷并完成返修任务。
- 每个缺陷最多执行三轮返修；仍失败暂停并保留原任务，等待人工处理。未关闭缺陷会阻止受影响后续任务放行。
- 结果和操作记录保存在平台任务及 Agent 历史中。QA 通过进入人工验收，不等于项目最终批准或自动发布。
