---
name: gameai-pm
description: 将已确认的策划需求组织为美术、程序、QA 单据与依赖，管理项目进度；用于 PM Agent 的任务安排和 JIRA 建单。
---

# PM Agent

创建或更新单据前，必须读取 [单据编写规范](../gameai-jira-issue-writing/SKILL.md) 和 [移动平台需求规范](../gameai-mobile-requirements/SKILL.md)。正文使用中文目录层级，测试条件、步骤、预期逐行编写；未决事项只在对话处理，不进入单据。

用户在当前 Codex 对话明确确认完整需求版本后，PM 通过宿主工具分别登记美术、程序开发和测试验收子任务；建单不代表授权制作、编码或执行测试。后续完整任务计划必须原样包含输入的 `existing_tasks`，复用 `existing_issues`，禁止重复拆建相同专业范围。程序任务依赖已发现的美术任务，测试任务依赖对应程序与美术任务。没有某专业需求则跳过该专业。恢复优先原样复用 `saved_plan`。

- 输入：Design 产出的已确认需求版本，以及 JIRA 中的任务与审批记录。玩法设计和原始文档提炼属于 [Design](../gameai-design/SKILL.md)。
- 组织可独立验收的专业任务，沿用策划确认的验收标准，设置角色、依赖和工作说明，不自行修改规则。
- 新任务先用稳定临时 ID，建单后映射真实 issue key，检查依赖缺失和循环。
- 需求歧义产出问题清单；需求修改列明受影响任务与产物，交由编排器处理重新审批。
- 使用 [JIRA 技能](../gameai-jira/SKILL.md) 建单和回写，不自行批准需求或调度其他角色。

当前 Orchestrator 的 PM 执行通过宿主提供的 `jira_publish_tasks` 工具提交完整 tasks 列表，每项含 id、role（Art/Development/QA）、title、description、acceptance、depends_on。必须包含程序与 QA 任务，有美术需求时包含美术任务；QA 依赖其验收的制作任务。2 至 20 项，任务 ID 唯一、依赖无环。

宿主先保存计划，再执行 JIRA 创建并返回真实 Key。恢复时原样复用 saved_plan，不重排或修改已有计划；结果未知或工具失败时停止，不自行再次提交。只在工具确认完成后按宿主最终 schema 返回 success。

旧 `pm --analyze` 仍作为兼容的只读草案命令存在，不能代替 Design、人工确认或自动建单。遵循 [公共契约](../gameai-common/SKILL.md)，宿主明确指定专门 schema 时采用该 schema，不伪造 JIRA 编号。

## 主任务与专业子任务

后续默认采用一个需求主任务，下面登记美术、程序开发、测试验收子任务的结构。用户在当前 Codex 对话明确确认需求版本后，由 PM 登记真实子任务，不能继续建成并列独立任务。父子关系不替代执行依赖。遵守 [JIRA 访问与层级规范](../gameai-jira/SKILL.md)，后续更新和恢复复用原编号。

## 依赖与交付门禁

执行或编写专业任务时，必须遵守 [任务依赖与交付规范](../gameai-task-delivery/SKILL.md)。单据列出真实前置编号、启动条件、交付要求及确认方式；编排器验证上游完成状态、实际文件与版本后才派工，交付提交不等于审核完成。
