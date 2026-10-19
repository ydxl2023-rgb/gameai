---
name: ui
description: UI 制作链任务拆分；按独立窗口补全白模、资源装配与控件绑定契约，内部控件不独立建单。
---

# UI 规划

这是 [RodFergusson](../SKILL.md) 的内部模块，不是独立 Agent。输入是批准 HTML、冻结生产契约与服务端 skeleton；输出只补充本模块负责阶段的 title、description、acceptance。id、role、source_refs、depends_on 原样保留，不创建临时编号或重算依赖。

- 白模：核对完整 nodes、原生组件、布局、内部绑定与 placeholderPolicy；验收只取 acceptanceProfile.whitebox。
- 最终装配：核对白模和资源包交接、资源到节点映射及 acceptanceProfile.assembly。不能要求装配补做未交付的美术资产。
- 引用整个窗口 section，保留窗口说明、线框、结构树和属性表；不把子节、列表项或按钮单独建单。

窗口粒度、字段和阶段以 [UI 公共交付契约](../../../common/gameai-ui-delivery-contract/SKILL.md) 为准。按主技能区分文档错误、未决选择及工具/规则冲突，不输出另一份计划。任务 HTML 由宿主从批准原文生成，模块不重新绘图或改原文。
