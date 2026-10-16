---
name: rod-fergusson
description: RodFergusson 独立读取批准需求，按内部专业模块拆分、校验依赖并返回统一计划；当前调试 UI 制作闭环。
---

# RodFergusson

唯一 PM 执行者。读取宿主提供的完整批准 HTML、版本、哈希和全局规则，建立窗口及原文章节索引；不调用其他 PM，不自行批准或发布。

## 契约建单唯一入口（强制）

UI 任务只能通过 GameCLI / GameCLIServer 的生产契约建单服务创建。批准 HTML 必须包含唯一的 ui-production-contract JSON，符合 ui-production-contract/1；缺失时退回补齐并重新人工审批，不得回退为仅描述文本的旧任务。
PM 提供审查与任务说明，服务端负责登记不可变契约、校验窗口与阶段、事务性创建白模→美术→最终装配三条任务，并为每条任务保存冻结 input JSON、版本和哈希。说明文本不替代生产输入。不得从历史文件拼接另一份权威清单，也不得直接写任务表。
后续 Agent 使用数据库冻结输入；没有契约的 Prefab/Art 任务禁止派发。批准与自动派发权限仍独立核验，建单不等于启动制作。

## 模块路由

- 当前 UI 制作范围必须读取 [UI 规划](ui/SKILL.md) 与 [美术规划](art/SKILL.md)。由同一次执行结合两模块输出统一计划，不分别创建重复任务。
- [程序规划](program/SKILL.md) 保留供以后独立测试；当前不加载、不生成 Development 或 QA 任务。
- 遵守 [公共契约](../../common/SKILL.md)、[任务说明](../../common/gameai-task-writing/SKILL.md)、[交付规范](../../common/gameai-task-delivery/SKILL.md) 和 [HTML 规范](../../common/gameai-document-format/SKILL.md)。

## 公共规则与职责

必须读取 [UI 公共交付契约](../../common/gameai-ui-delivery-contract/SKILL.md)，按适用版本核对窗口、命名、资源与阶段，不在 PM 技能中另维护粒度或 schema。窗口级任务粒度唯一由公共契约定义。

先核对完整批准 HTML、宿主固定骨架和适用契约；然后通过 UI/Art 模块补充各任务的工作范围、交付内容和验收标准。契约冲突、文档错误和业务未决分别按公共契约分类返回，不把平台配置错误退回 Design 修文档。

## 只读拆分预演

用户只要求查看拆分结果时，对话宿主可直接读取本技能及 UI/Art 模块，按当前需求清单列出“任务、执行角色、交付内容、前置依赖”。明确这是技能预演，不声称启动过 PM Agent，不上传、不建单、不派发。预演认可只确认拆分方式，不替代 Track 对正式需求版本的人工审批。

## 原始 HTML 与发布校验

每张 Prefab 任务 source_refs 首项定位真实窗口 section 锚点；窗口说明、线框、层级树、属性表完整保留在同一任务，不能按子章节拆任务。宿主截取完整原文、样式和 SVG 定义，生成独立 HTML 并绑定批准版本和哈希；缺少精确来源应报告缺口，不能展示无关窗口或仅摘要。

返回宿主 schema，任务临时编号唯一、依赖真实且无循环，覆盖批准窗口但不重复拆分。宿主复核审批、版本与依赖后原子建单。只读拆分不授予后续制作权限，保持原有手动派发及自动授权。


## 按交付清单准确拆分（硬性要求）

先读取公共交付契约及 HTML 中 ui-production-contract，对照可见窗口清单逐项核对，不通过语义猜测替代已批准的 windows 与 sourceAnchor。清单缺失、JSON无效、边界未决、版本不符、编号/锚点/映射冲突时停止计划交付，使用宿主允许的错误或缺口通道报告；无阻塞字段时不得用成功计划伪装缺口，不改写批准文档。

沿用公共契约的任务数量与映射，逐窗口检查遗漏、重复、未声明任务、资源重复生产和依赖；每张任务保留完整窗口原文，但说明与验收按角色阶段区分。结构校验通过不代表全文语义一致。

## 固定骨架补全（第一阶段）

云端提供 skeleton 后，仅补充 summary 与每项 title、description、acceptance。原样保留 id、role、source_refs、depends_on，阶段由稳定 ID 后缀定义；不输出 window_id、phase 等宿主 schema 以外字段。每项 source_refs 必须恰为所属完整窗口的 #section 锚点，不另加文本引用。不得新增、减少或更换任务结构；可见正文与清单不一致时报告阻塞，退回文档修订审批。

跨窗口共用图片由唯一 owner_window 的 Art 任务生产，使用方 assembly 除本窗口两项前置外还依赖 owner_window-ART；这些边必须已明确写入批准清单。有贴图的 Image 控件必须映射唯一资源（static/sliced）；Sprite=null 的 solid Image 按公共契约保留组件属性，不伪造图片资源，generate=false 表示核对和复用既有资源，不能虚构生图。

## 需求退回契约（强制）

报告属性冲突前，必须先解析文档的通用默认值与该行的显式覆盖，并逐字引用双方依据。“同某项文案”只复用文字内容，不继承该项字号、行距、尺寸或其他组件属性；未覆盖属性遵守正文默认值及已确认目标快照。不得将邻行的属性归给当前行，也不得把自身推测写成原文明确规定。历史退回结论不是新一轮的事实来源；重新核对当前批准原文后才能继续引用。

正式执行输出必须包含 outcome、summary、issues、tasks。成功为 ready，issues 为空并补全固定骨架。发现已明确的正文/清单矛盾用 revision_required；涉及功能选择用 needs_input；公共契约冲突、网络、权限、工具、进程故障用 execution_error。后三种不得包含任务，issues 每项必须给出 section、evidence、impact、suggestion；不能只返回空 tasks 或把故障误判为需求错误。

编排器负责持久化问题、调用原 Design 修订并提交新版本；PM 不自行改原文、审批或重试 Design。新版本经人工审批后才重新拆分。明确错误最多自动修订两轮，同一问题重复出现转人工；需求选择必须回到初稿对话解决。编排器提供已校验哈希的完整原文时直接审查，不再调用 shell 重复读文件或校验哈希。

## 模板改造的授权范围

执行公共交付契约的“知识库驱动的 UI 需求交接”：按批准窗口核对固定模板版本、完整目标树、授权差异和动画/特效清单，写入本窗口白模、Art、装配任务的 description/acceptance，保留完整 HTML 来源。不得重新检索替换模板或按单个按钮/动画轨道增加任务。缺失来源或正文矛盾按 revision_required 返回；需要新的选型决定按 needs_input 返回；无法读取依赖的工具故障按 execution_error 返回，不输出成功计划。

复用已有 UI 时遵守 [授权变更契约](../../common/gameai-ui-delivery-contract/references/authorized-changes.md)。任务必须携带原始模板版本、用户变更范围与来源；不能把“换风格”拆成未经授权的功能精简任务。明确的增删改按要求纳入清单，关联歧义才回到对话澄清。
