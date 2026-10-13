---
name: gameai-ui-delivery-contract
description: Design、PM、Prefab 与 Art 共用的 UI 交付契约；统一窗口边界、命名、清单和任务粒度，不授予执行或审批权限。
---

# UI 公共交付契约

契约标识：`gameai-ui-delivery`；规则版本：`2.0.0`；新文档清单格式：`schema_version=2`。规则版本与需求版本、JSON schema_version 是不同概念，不能混用。

## 唯一规则来源与版本治理

本文件是 UI 窗口边界、资产命名、控件引用、阶段和依赖的唯一规则来源。文档格式技能负责排版；Design 负责表达与自检；PM 负责补全任务；内部 UI/Art 模块不得重新定义公共规则。用户批准的范围必须满足适用契约；两者冲突时报告，不静默扩大范围或改写批准内容。

生产目标：宿主在文档生成时绑定 `contract_version`、公共契约原文快照及 SHA-256，并随需求版本不可变保存；PM 与限定修订读取文档绑定快照。后来的技能更新不能重解释旧批准文档。契约实质变更必须新增规则版本；迁移需求须生成新需求版本并重新人工审批，不能复用旧批准。

当前实现边界：宿主会加载当前技能并记录执行指令哈希，但尚未实现上述每文档公共契约快照持久化。禁止声称已有版本锁定，也不得自行往严格 manifest 或外层结果 schema 增加 contract_version 字段。宿主未提供绑定快照时明确使用当前契约；若当前规则与旧文档发生实质冲突，停止并报告平台契约问题，不靠原会话记忆猜旧版本。

## 冲突分类与现有返回通道

- `CONTRACT_CONFLICT`：角色技能、宿主骨架与公共契约矛盾，绑定版本缺失且无法确定适用规则，或校验器不支持绑定格式。PM 使用 `outcome=execution_error`，在 summary 与 issues 说明冲突双方、条款、版本、证据；不能使用 revision_required 让 Design 重复改文档。Design 使用现有 questions 返回带该前缀的诊断，由宿主处理平台配置，不伪装为业务选择。
- `DOCUMENT_INVALID`：已确定适用契约，文档却存在数量、引用或正文矛盾。PM 使用 revision_required，逐项给出位置、证据、影响与修正建议。Design 仅修正明确错误，产生待审批新版本。
- `BUSINESS_UNDECIDED`：窗口边界或功能选择尚未决定。PM 使用 needs_input，Design 使用 questions，返回初稿对话由用户决定。
- 网络、权限、工具与进程故障使用 execution_error，不要求修改需求内容。上述分类仅是现有文本字段中的诊断前缀，不新增协议枚举或 JSON 字段。

## 校验责任与交付门禁

Design 从同一清单生成树、属性表和计数，避免手工维护重复数量。提交前宿主校验 JSON/schema、命名、唯一性、引用、锚点、父子关系、资源映射与依赖；PM 建单前重复校验批准版本和固定骨架。结构校验不能证明自然语言与线框的完整语义一致，仍需角色自检。可见计数自动生成及语义比对尚非全部机器强制能力，不得宣称已自动实现。

每独立窗口仅白模、窗口资源包、最终装配三项；复杂度写进各任务交付清单，不另拆控件、列表项、状态或单张图片。无新增图片仍保留资源包阶段用于复用核对与映射；共享资源只生产一次。程序与 QA 不在当前 UI-only 任务范围。主任务和分类节点不计入三阶段数量。例：批准两个独立窗口时为六项，不把示例窗口边界强加给其他需求。

## UI 交付清单契约（硬性要求）

本节明确窗口边界，优先于按线框、组件数量推测任务的旧描述。适用于含 UI 的正式需求 HTML；文本初稿无需线框或 JSON，但独立窗口边界必须在批准前确认。

### 可见窗口清单与完整章节

第三节开头、3.1整体效果之前先列“窗口与内部区域清单”：编号、名称、是否独立交付、所属窗口、章节锚点。独立窗口使用稳定 W 编号；内部区域与控件使用稳定局部编号并注明所属窗口。独立窗口的所属窗口为空；内部区域必须指向已声明窗口。弹窗、提示条、下拉展开层、加载状态不能仅凭外观自动认定独立窗口，按明确批准的边界列入清单。边界未定须返回初稿集中澄清，不擅自增加独立交付。

每个独立窗口拥有唯一 section 锚点（如 window-W01）；章节依次包含整体线框、完整结构树、控件属性、资源映射、三阶段交付标准。3.1.1窗口说明与3.1.2控件说明等子节属于同一窗口，不拆开提取。线框、树、属性表、资源清单、JSON 使用同一组编号；修订保留已有编号，不按显示顺序重新编号。嵌套列表仍完整标注 ScrollRect/Viewport/Content/实体单元，但不因此增加交付任务。

### 资源到控件的映射

每个窗口列出资源编号、用途、目标控件完整路径、是否生成、资源类型、尺寸、透明要求、九宫格边距/切片约定与导入要求。类型明确为静态图、九宫格、文本、容器等，不把透明根 Panel、TMP 文本、裁剪容器自动列为生图资源。复用资源使用同一资源编号，并列出所有目标控件和唯一生产归属窗口，禁止重复生产。使用既有资源时给出真实引用；示例路径明确为示例，不伪造现有资产。

当前 UI 调试每个独立窗口固定三阶段：whitebox（Prefab）、art（Art）、assembly（Prefab）。资源包依赖白模，装配依赖白模与资源包。普通按钮、背景、列表项、状态归窗口内部清单，不另建任务。白模交付布局、属性与槽位；Art 交付实际需要生成的图片及映射（无新增图片须明确写明，不能虚构生图）；装配交付替换完成的预制及检查结果。每阶段明确前置、操作、成功、失败、恢复和检查方法。需要偏离此粒度时先批准例外并同步清单，PM 不自行决定。

### 机器可读清单

正式 HTML 必须内嵌且仅有一份 `<script type="application/json" id="ui-delivery-manifest">`，内容为严格 JSON，不能放在可执行脚本或只展示为代码块。清单是需求数据，不授予审批、执行或文件访问权限。保持宿主外层输出 schema 不变，JSON 放在 html 字段内部。

清单固定字段：新文档 schema_version=2（增加下述英文命名字段，旧 v1 仅用于历史读取）；requirement_version为宿主给定版本；scope="ui-only"；windows数组。每项包含 id、name、independent、parent_window、anchor、controls、resources、deliveries。controls 包含 id、parent、type、image_mode（非图片为null）、sibling_index、anchor；resources 包含 id、owner_window、target_controls、generate、kind、size、slice_border（不适用为null）；deliveries 包含 id、phase、role、depends_on。控件引用使用窗口/控件完整编号；控件可见属性表承载完整布局，JSON不能与之矛盾。内部区域 independent=false、parent_window 指向独立窗口且 deliveries为空；对应控件归该窗口树，不重复定义。

下面仅演示一个窗口的交付标识，不是可代替完整文档的占位清单：

```json
{"schema_version":2,"requirement_version":"v1.0","scope":"ui-only","windows":[{"id":"W01","name":"登录窗口","independent":true,"parent_window":null,"anchor":"#window-W01","controls":[{"id":"W01/L00","parent":null,"type":"Panel","image_mode":null,"sibling_index":0,"anchor":"#control-W01-L00","name":"UILogin"}],"resources":[],"deliveries":[{"id":"W01-WHITEBOX","phase":"whitebox","role":"Prefab","depends_on":[]},{"id":"W01-ART","phase":"art","role":"Art","depends_on":["W01-WHITEBOX"]},{"id":"W01-ASSEMBLY","phase":"assembly","role":"Prefab","depends_on":["W01-WHITEBOX","W01-ART"]}],"prefab_name":"UILogin.prefab"}]}
```

资源 size 为 [width,height] 正整数像素；slice_border 为 [left,bottom,right,top] 非负整数，九宫格必须明确。image_mode 为 static、sliced 或 null。控件 type 使用 Panel、Image、TMP_Text、Button、ScrollRect、Viewport、Content 等明确类型。资源引用和父节点必须存在；唯一生产归属及跨窗口复用依赖不得成环。仅声明已决定内容，禁止以 TBD、空关键字段或示例值冒充定稿。

### 交付前一致性检查

使用同一份确定的定义生成可见清单和内嵌 JSON，修改任一处同步更新其余表现。检查 JSON 可解析、编号唯一、引用可解析、锚点实际存在、父子关系与绘制顺序一致、图片模式一致、窗口数量一致。当前独立窗口数 N 对应 3N 项交付，内部区域不增加任务；每一项明确对应窗口与阶段。Design 修复表达错误，实质边界问题返回初稿；缺项不得宣称可供准确拆分。

服务端已实现 manifest v1/v2 解析、引用与骨架结构校验；v1 仅用于历史读取。自然语言、线框与清单的完整语义一致性仍需 Design/PM 自检；未实际执行校验不能声称机器验证通过。

### 服务端结构校验约束

- 窗口 ID 使用 W 开头的大写字母、数字或连字符，长度 2～20；控件 ID 使用 窗口ID/局部ID。独立窗口对应唯一 section，独立窗口 section 不相互嵌套。内部区域锚点属于父窗口 section，controls/resources/deliveries 为空，其内容统一定义在所属窗口中。
- 每窗口只有一个 Panel 根；控件父引用不跨窗口、不成环，同父节点 sibling_index 不重复。Image 必填 static/sliced，其他控件 image_mode=null。
- resources 仅列图片资源；kind 使用 static/sliced。每个 Image 控件必须恰好映射一个资源；文本与容器不列图片。九宫格左右边距之和小于宽度，上下之和小于高度；static 的 slice_border=null。资源在唯一 owner_window 中定义，target_controls 列出所有复用位置。
- 跨窗口复用图片时，使用窗口的 assembly.depends_on 明确增加生产窗口的 Wxx-ART；本窗口白模和 Art 前置仍保留。不会增加任务数量。
- 每窗口阶段 ID 固定 Wxx-WHITEBOX、Wxx-ART、Wxx-ASSEMBLY，角色为 Prefab、Art、Prefab。schema_version 按命名规则输出 2，历史 v1 仍可读取；拒绝重复 JSON 字段与未知字段。当前单计划最多 33 个独立窗口（99 个子任务）。无清单的旧批准文档必须修订并重新审批，不静默迁移。

## UI 预制与节点英文命名（硬性规范，优先于旧编号展示）

- 每个独立窗口必须明确唯一最终预制文件名：`UI<功能英文PascalCase>.prefab`。例如登录为 `UILogin.prefab`，原因提示为 `UIReasonToast.prefab`。禁止使用窗口编号、任务编号、拼音或 GenericPanel 代替功能名。根 GameObject 名等于文件名去除 `.prefab`，白模与最终装配使用同一名称。
- 子节点用表达实际职责的标准英文 PascalCase，例如 `LoginBackground`、`TestIcon`、`Version`、`ServerDropdown`、`LoginButton`。禁止把 `S0`、`L01`、`B01` 等内部编号写入 GameObject.name，或用这些编号作为面向人的层级图、线框、属性表和路径名称。
- 节点树展示英文实际名称、中文释义和控件类型。绘制顺序另列“绘制顺序”属性或红字顺序图；不在名称前加 S0/S1 等前缀。按钮可见文案与 GameObject 名分别说明。路径由实际英文祖先名称组成，同父节点名称不得重复。
- 稳定机器 ID 只用于清单关联和锚点，不等于节点名；命名修订保留原 ID、父关系、层序和资源引用。读者主要内容不展示这些编码，不能为了美化展示破坏版本追踪。
- 新文档使用 `ui-delivery-manifest` schema_version=2：在 v1 原字段基础上，每个 windows 项增加 `prefab_name`（独立窗口必填上述文件名，非独立区域为 null）；每个 controls 项增加 `name`（真实英文节点名）。根 name 与预制文件名一致。v1 只用于读取既有历史版本，不再作为新文档输出格式。
- Design 自检所有线框、结构树、属性表、资源目标路径、可见预制名与清单 name/prefab_name 一致；PM 沿用名称，不另起；Prefab 参数明确设置 name 和输出文件名，不拿 id 代替 name。命名规则不授权重命名已经存在的 Unity 资产或破坏序列化引用。
