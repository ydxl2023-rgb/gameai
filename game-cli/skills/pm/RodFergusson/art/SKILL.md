---
name: art
description: 美术资源任务拆分；按 UI 白模布局及控件属性规划图片、图标、动画和特效交付。
---

# 美术规划

这是 [RodFergusson](../SKILL.md) 的内部模块，不是独立 Agent。输入是批准 HTML、冻结生产契约与服务端 skeleton；输出只补充本模块负责阶段的 title、description、acceptance。id、role、source_refs、depends_on 原样保留，不创建临时编号或重算依赖。

- 按冻结 resourceSlots、animations、effects 和 acceptanceProfile.art 补全本窗口资源包说明；未交付白模是前置依赖，不能声称已读取。
- imagegen 需要真实生图，reuse/preserve 需要来源核验；透明容器和原生文字不新增图片。核对尺寸、绑定、图片模式、图层、导入参数及实际要求的预览。
- 动画片段、控制器、特效属于本窗口资源包；最终预制绑定和真机交互不作为 Art 的前置检查。跨窗口生产关系若超出当前 schema，报告能力缺口，不自行造依赖。

窗口粒度、字段和阶段以 [UI 公共交付契约](../../../common/gameai-ui-delivery-contract/SKILL.md) 为准。按主技能区分文档错误、未决选择及工具/规则冲突，不输出另一份计划。任务 HTML 由宿主从批准原文生成，模块不重新绘图或改原文。
