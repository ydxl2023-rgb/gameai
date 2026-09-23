# Oathx.Core Runtime 编码规范分析与整理

分析日期：2026-09-23。

参考目录：`G:\My\u3dx\developments\v0\client\LocalPackages\com.oathx.core\Runtime`。

范围：该目录全部 22 个 C# 文件（共 5,196 行，包含空行与注释），以及 `com.oathx.core.asmdef`。结论来自静态源码阅读，没有执行 Unity 编译或运行测试。本文不修改参考源码，也不自动替换 GameCLI 现有开发规范。

## 1. 结论与使用方式

这套代码以 Unity 运行时框架为中心，采用 `X` 前缀框架类型、接口隔离、单例服务、插件生命周期、事件分发、状态机，以及协程和回调式异步。SDK 功能通常将数据模型、接口、内部实现与访问门面组织在一个功能文件中。

源码并没有完全统一的编码风格。Allman 大括号比较稳定，但缩进、属性命名、访问修饰符、控制流括号、命名空间和错误处理均存在差异。因此，本文使用两种标记：

- **现状**：源码中实际采用的写法；不代表每个文件都一致，也不自动代表最佳实践。
- **建议约定**：适合后续开发采用的统一规则；其中部分属于补齐约束，而非已有实现。

修改旧代码时优先维护序列化、网络字段和公开 API 的兼容性。新代码可采用建议约定，但不要为统一外观批量改名已有字段、命名空间或协议成员。

## 2. 文件与职责清单

| 文件 | 主要职责 |
| --- | --- |
| `XApp.cs` | 应用启动、版本检查、更新、程序集运行与插件驱动 |
| `XAppConfigure.cs` | ScriptableObject 配置与地址生成等配置逻辑 |
| `XBootstartup.cs` | 启动界面、版本文字与进度显示 |
| `XHotfixBox.cs` | 热更新确认界面与按钮回调 |
| `XAssemblyHelper.cs` | 程序集加载、登记与类型查找 |
| `XPlugin.cs` | 插件生命周期抽象 |
| `XPluginManager.cs` | 插件注册、查询、卸载、更新及全局事件入口 |
| `XEventDispatcher.cs` | 事件模块管理与事件转发 |
| `XEventModule.cs` | 事件契约、监听注册、触发及延迟修改处理 |
| `XSimpleSingleton.cs` | 普通 C# 类型单例基类 |
| `XMonoSingleton.cs` | MonoBehaviour 单例基类 |
| `XCoreCoroutine.cs` | 协程宿主组件 |
| `XCoroutine.cs` | 静态协程启动与停止入口 |
| `XTimer.cs` | 多层时间轮定时器 |
| `XActionStateMachine.cs` | 以委托表达状态行为的状态机 |
| `Machine/AIState.cs` | 状态对象、生命周期钩子与状态机操作转发 |
| `Machine/AIStateMachine.cs` | 状态栈、命令抽象、事件与状态调度 |
| `Sdk/XAppSdk.cs` | 平台登录、退出接口与访问门面 |
| `Sdk/XAppTracking.cs` | 埋点、登录及广告相关协议和适配 |
| `Sdk/XAppProduct.cs` | 商品、订单、支付、消费与交付 |
| `Sdk/XAppEmail.cs` | 邮件读取与领取 |
| `Sdk/XAppActivity.cs` | 活动查询 |

## 3. 目录、程序集与命名空间

**现状**

- 核心服务位于 `Runtime` 根目录；状态机集中于 `Machine`；业务 SDK 集中于 `Sdk`。
- 核心命名空间为 `Oathx.Core`。`Machine` 内类型仍使用它，没有强制与物理目录逐层对应。
- 大部分 SDK 使用 `Oathx.Core.Sdk`。活动模块例外，使用拼写为 `Oathx.Core.Actitvity` 的命名空间。
- `XTimer` 与 `XHotfixBox` 位于全局命名空间。
- 程序集名称为 `Oathx.Core`，`rootNamespace` 为空，未限制编译平台，禁用 unsafe，并自动被引用。引用配置中包含两个 GUID；本文不据此推断其具体程序集名称。
- 一个文件可包含主类、关联 DTO、枚举、接口、委托或辅助类型。源码不是严格的“一文件一类型”。

**建议约定**

1. 按职责划分目录，避免用目录层级表达暂时没有意义的抽象。
2. 新增类型必须明确命名空间。核心沿用 `Oathx.Core`，SDK 沿用 `Oathx.Core.Sdk`；新子命名空间按实际模块需要设立。
3. 主文件名与主要类型名一致；紧密关联的小型协议类型可同文件。独立复用、独立演进或明显过大的类型拆文件。
4. UnityEditor 依赖放入 Editor 程序集；确需在共享源码中使用时必须正确限制编译范围。
5. 保持 Unity 资产与 `.meta` 成对维护，不为整理目录重新生成已有 GUID。

参考：[程序集定义](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/com.oathx.core.asmdef)、[活动模块](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Sdk/XAppActivity.cs:8)。

## 4. 命名规范

| 对象 | 源码现状 | 建议约定 |
| --- | --- | --- |
| 框架类型 | `XApp`、`XPlugin`、`XCoroutine` | 在该框架内延续 `X` 前缀，不要求所有业务类型加 `X` |
| 接口 | `IEvent`、`IProductAPI` | `I` + 职责名称，表达能力或契约 |
| 内部适配实现 | `InternalProductAPI` | 延续同模块的 `Internal…API` 命名；名称不代表实际访问级别为 internal |
| 数据模型 | `Product`、`Order`、`Email` | 使用业务名词，不添加框架前缀 |
| 结果类型 | `…Result` | 明确操作结果，区分请求、数据与错误 |
| 方法 | `RegisterAPI`、`GetProducts`、`OnEnter` | PascalCase，优先动词或动宾结构 |
| 私有字段 | `core`、`modules`、`assemblys` | camelCase；沿用无 `_`、无 `m_` 的习惯，使用正确完整词汇 |
| 参数、局部变量 | `url`、`eventName`、`req`、`conf` | camelCase；常见缩写可保留，避免难以理解的简写 |
| 公开属性 | DTO 的 `projectId`、`success`；状态类型的 `Name`、`Flag` | 新增普通对象属性使用 PascalCase；协议 DTO 见下文 |
| 枚举与成员 | 以 PascalCase 为主，广告协议存在 `rewarded`、`app_open` | 普通枚举 PascalCase；协议值使用显式映射保持兼容 |
| 泛型参数 | `T`，配合类型约束 | 单一类型参数用 `T`；多个参数用 `TEvent` 等有意义名称 |
| 布尔查询 | `HasEvent`、`IsCurrent`、`TryConvertRemoteVersion` | `Is/Has/Can` 表示判断，`Try…` 表示允许失败的尝试 |
| 生命周期钩子 | `OnActive`、`OnEnter`、`OnLeave` | `On…` 表示可扩展钩子；外部入口负责状态与顺序 |
| 协程内部方法 | `DoGetProducts`、`DoLogin` | 同类内可沿用 `Do…`，并明确返回 `IEnumerator` |

### 4.1 DTO 属性与协议兼容

lowerCamelCase 公开属性是本目录非常明显的风格，不能把“所有公开属性均为 PascalCase”描述成原有规范。SDK 的 JSON 序列化大量依赖这些名称。

新 DTO 可选择以下一种方式，并在同一模块内保持一致：

- 延续已有 lowerCamelCase 协议属性，减少迁移成本。
- 使用 PascalCase C# 属性，通过 Newtonsoft.Json 的显式字段映射保持线上 JSON 名称。

例如 `ConsumeResult.succees` 是现有拼写，不能只因为它拼错就直接改为 `Success`；必须先确认服务端字段和调用方，并决定兼容映射或迁移方式。枚举 `ToString()` 被用于协议时，改成员名称也可能改变线上数据。

### 4.2 缩写与历史拼写

现有 `API`、`URL`、`Url` 大小写不统一，且存在 `Actitvity`、`IActitityAPI`、`GetActivitys`、`assemblys` 等拼写。新代码采用统一正确拼写；旧公开名称按兼容性变更处理，不能作为新规范继续复制。

参考：[商品模型与协议](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Sdk/XAppProduct.cs)、[状态对象](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Machine/AIState.cs)。

## 5. 排版与声明

**现状**：类、方法和多数带括号的控制流使用 Allman 风格。多数业务文件使用四空格，但单例、定时器等使用 Tab，个别文件混用。单语句 `if/for` 经常省略大括号；访问器存在 `{ get; set; }` 紧凑写法；lambda 和对象初始化器也存在同行括号。`var` 与显式类型并用，访问修饰符并非处处显式。

**建议约定**

1. 使用四空格缩进，不混入 Tab。类、方法、命名空间、控制流的大括号独占一行。
2. `if/else/for/foreach/while` 等控制流始终写大括号。
3. 每行一个字段或局部变量声明、一个语句；正常 `for` 头部除外。
4. 每个访问器单独一行。成员之间、不同逻辑段之间保留一个空行。
5. 显式声明类型及成员的访问级别，避免依赖默认 private/internal。
6. 二元运算符两侧、逗号之后留空格；控制流关键字与左括号之间留空格；方法名与左括号之间不加空格。
7. `var` 仅用于右侧类型明确或匿名类型等情况；不为了少写字符掩盖关键类型信息。
8. 多行初始化器和较长 lambda 按相同缩进层级展开，避免一行塞入多个业务动作。
9. `using` 放在文件顶部，移除未使用引用；建议依次分组为 System、第三方/Unity、项目命名空间。此顺序是新增约定，源码没有一致排序。
10. 长参数列表、调用链按语义换行。此次没有从源码确认统一的最大行宽、换行符、BOM 或编码设置，不能声称已有相关标准；落地时应由项目配置明确。

## 6. 注释规范

**现状**：英文 XML 文档注释覆盖较广，包括类型、接口、字段、属性和方法；实现注释也以英文为主。但部分 `<summary>`、`<param>`、`<returns>` 为空或与实际行为不符。

**建议约定**

- 公共契约写 XML 注释，说明用途、输入约束、返回语义和生命周期责任。
- 回调必须说明触发时机、次数、线程、失败表示及对象销毁后的处理。
- 实现注释用简明英文解释数据归属、执行顺序、重入处理和非显然算法，不重复翻译代码。
- 不添加空注释模板，不复制已失效说明。修改行为时同步更新注释。
- 注释描述“当前实现”，不能将计划功能写成已完成能力。

## 7. 类型设计与设计模式

| 结构 | 源码表现 | 使用边界 |
| --- | --- | --- |
| 单例 | `XSimpleSingleton<T>`、`XMonoSingleton<T>` | 框架级共享服务；并非完整的防重复实例或跨线程保障 |
| 接口与适配实现 | `IProductAPI` + `InternalProductAPI` | 契约隔离具体平台或网络实现 |
| 门面 | `XAppProduct`、`XAppEmail` 等 | 提供统一调用入口，隐藏实现集合 |
| 观察者/发布订阅 | `IEvent`、监听器、事件分发器 | 降低模块直接依赖，必须约定订阅生命周期 |
| 模板方法 | Active/Detive 配合 OnActive/OnDetive | 基类组织流程，子类实现钩子；现有约束不完全一致 |
| 状态模式与状态栈 | `AIState`、`AIStateMachine` | 状态行为与切换管理分离 |
| 委托式状态机 | `XActionStateMachine` | 通过 enter/update/leave 委托描述轻量状态 |
| 命令抽象 | `AICommand.Execute/Undo/Redo` | 仅有扩展入口，不能认定已实现撤销历史系统 |
| 反射工厂式创建 | `Activator.CreateInstance`、泛型 `new()` | 按类型创建插件或模块，不是完整依赖注入容器 |

### 7.1 SDK 的推荐职责划分

沿用以下现有结构：

`调用方 → XApp… 门面 → I…API 契约 → Internal…API 实现 → 网络/平台服务`。

- DTO 只表达数据契约；不把网络执行、Unity 界面或全局单例访问塞入数据模型。
- 接口表达业务能力；内部实现处理 URL、请求、序列化和平台细节。
- 门面处理实现注册与选择、广播或结果汇总；不要把这些策略隐含在一次循环中。
- 外部依赖可通过构造参数注入；源码已有配置、地址等构造参数传入的例子，不必让所有依赖都通过单例取得。
- 可独立使用的框架逻辑尽量保持普通 C# 类型；只有需要 Unity 生命周期或场景对象时继承 MonoBehaviour。

参考：[SDK 登录接口与门面](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Sdk/XAppSdk.cs)、[商品适配实现](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Sdk/XAppProduct.cs:369)。

## 8. 插件与模块生命周期

**现状**：`XPlugin` 定义 `Install → Startup → Shutdown → Uninstall` 四个入口。管理器负责加载和卸载；应用代码在加载后调用 Startup。因此，不能把 LoadPlugin 描述为已经完成插件启动。

事件模块还存在 `Install/Uninstall`、`Active/Detive` 和 `OnActive/OnDetive`。当前 Dispatcher 加载时调用 Active，不等于会自动执行所有生命周期入口。存在 `AutoLoadOnStartup` 属性声明，但此次范围内未见对应自动扫描机制，不能认定自动发现已经实现。

**建议约定**

1. 明确谁负责创建、安装、启动、停止和销毁；同一阶段只能由一个归属明确的管理者驱动。
2. 安装失败不注册，启动失败不标记可用，并回收此前已取得的资源。
3. 泛型和 Type 重载必须具有一致的成功、失败及清理语义。
4. Shutdown 停止活动行为和任务；Uninstall 释放注册、订阅及持有资源；清理应允许安全重复调用。
5. 不将安装、启动、启用混为一个布尔值。若增加 enable/disable，应单独规定状态转换；本目录的 XPlugin 尚无独立 enable/disable 契约。
6. 避免仅以 `Type.Name` 作为跨模块唯一身份；同名类型可能冲突，新增设计可用 Type 或显式稳定 ID。
7. 对注册表的修改不能破坏正在进行的迭代；规定延迟修改或快照策略。

参考：[插件契约](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XPlugin.cs:7)、[插件管理器](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XPluginManager.cs)、[应用启动调用](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XApp.cs:379)。

## 9. 事件与状态机约定

### 9.1 事件系统

**现状**：使用 `IEvent` 标记、泛型监听接口与委托；监听器有整数 ID；部分订阅修改延迟执行；全局事件可入队后集中分发。实现大量使用普通 Dictionary/List/Queue，未体现线程同步保障。

**建议约定**

- 默认在 Unity 主线程注册、取消订阅和分发。跨线程入口必须另行提供同步或调度，不假设现有容器线程安全。
- 订阅者负责在停用或销毁时取消订阅；延迟事件明确载荷归属、有效期和可变性。
- 触发中增加、删除监听器必须采用一致策略；按类型删除和按 ID 删除不能语义不同。
- 对回调导致的重入建立明确契约；使用正确的嵌套状态和 `try/finally` 恢复内部状态。
- 规定单个监听器异常是否中断分发；不得意外使分发器永久停留在“正在触发”状态。
- `PostEvent` 中的对象去重不等于业务幂等；需要幂等时使用业务身份与明确规则。

### 9.2 状态机

**现状**：状态定义进入、更新、离开与事件钩子；状态机负责栈及当前状态，支持 Pause/Resume。两套状态机分别使用对象继承和委托表达行为。

**建议约定**

- 明确 Enter/Leave 的调用顺序，以及暂停是否仅影响 Update。
- 若钩子返回 bool，则必须定义失败后的状态；不能返回失败却仍无条件标记进入完成。
- 栈空、栈非空、重复状态、嵌套切换均要有清楚语义。List 末项索引必须是 Count - 1。
- 状态行为通过状态机入口切换，避免外部直接改写状态集合；源码公开集合不应成为新设计默认值。
- `Undo/Redo` 只有明确逆操作和历史管理才算支持撤销；空方法不能作为已支持的证明。
- `AIState` 等类型的隐式 bool 转换属于本目录特殊习惯，新类型不默认复制，以免隐藏普通引用判空语义。

参考：[事件模块](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XEventModule.cs)、[对象状态机](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Machine/AIStateMachine.cs)。

## 10. 异步、网络与回调

**现状**：本目录主要使用 `IEnumerator`、`yield return`、`UnityWebRequest` 和 `Action<…>`；通过 `XCoroutine.Run` 执行。未见基于 Task/async/await 的统一异步设计。

一些 API 立即返回 bool，同时稍后通过回调返回结果。这个 bool 通常反映请求是否被发起或处理，不等于远端业务成功；不同接口并未完全统一这一语义。

**建议约定**

1. Unity 运行时模块延续协程模式时，明确句柄、取消入口和宿主生命周期。不能把协程等同于后台线程。
2. 清楚区分“受理成功”“传输成功”“业务成功”；建议注释明确，复杂场景使用结果类型。
3. 单个提供者的一次请求，最终完成回调应至多一次；成功、失败、空响应、反序列化失败和取消均有定义。
4. 门面若广播给多个提供者，要说明可能多次回调，或增加明确的汇总结果。源码没有全局“仅回调一次”保证。
5. 在解析响应的 try/catch 外调用业务回调，避免把调用方抛出的异常误当网络失败，再次回调。
6. 请求配置超时；需要取消时真正终止请求或明确忽略过期结果。
7. 使用明确的所有权释放 UnityWebRequest 及其处理器；资源清理必须覆盖异常和取消路径。
8. JSON 请求采用 UTF-8，设置适当 Content-Type；响应解析后还要校验必填值和业务成功字段。
9. URL 拼接集中处理路径、参数编码和斜杠，不直接拼接不可信参数。
10. 日志不得输出访问令牌或完整敏感响应；失败需要保留足以定位请求的上下文。
11. 时间、金额、枚举等协议值显式约定格式、精度和文化区域；当前 `DateTime.Now.ToString()` 或 float 价格用法不能自动上升为通用规范。

以上超时、取消、资源释放、回调次数等约束属于补齐建议，不能描述成当前 SDK 已全面满足。

参考：[埋点请求实现](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Sdk/XAppTracking.cs:274)、[协程入口](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XCoroutine.cs:21)。

## 11. Unity 序列化、资源与生命周期

- **现状**：界面组件主要采用 `[SerializeField] private` 字段；配置对象也存在 `[SerializeField] public` 字段；ScriptableObject 用于配置资源。
- **建议约定**：Inspector 引用优先私有序列化字段，向外只暴露必要只读访问；不要为方便外部修改而把内部状态全部公开。
- Unity 序列化字段与 Newtonsoft.Json 属性是两套契约，不可互相替代。改字段名、类型、命名空间或脚本位置之前评估资产与反射依赖。
- 普通单例适合无 Unity 对象生命周期的服务；MonoBehaviour 单例必须考虑重复实例、场景切换、退出与 Domain Reload 配置。
- 源码中的泛型 `new()` 单例和公开 static instance 并不阻止调用方创建其他实例，也不代表其业务操作线程安全。
- 事件、按钮监听、协程、请求、定时器应有成对注册/释放。反复打开界面时避免累计 AddListener。
- 缓存集合若引用不重新赋值，可声明 readonly；这不代表集合内容不可变或线程安全。
- 定时器明确秒/毫秒单位、首次触发、循环与取消语义；时间轮属于专用算法，不能把其中简写命名和索引技巧推广到普通业务代码。

参考：[MonoBehaviour 单例](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XMonoSingleton.cs)、[配置对象](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XAppConfigure.cs:65)、[确认窗口](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XHotfixBox.cs)。

## 12. 错误处理与条件编译

**现状**：混合使用 false/null、回调失败、日志和异常。多处日志由 `UNITY_EDITOR` 或 `UNITY_EDITOR || UNITY_DEVELOP` 控制；`UNITY_DEVELOP` 应视为项目使用的符号，不能据名称认定为 Unity 自动定义。

**建议约定**

- 参数与状态检查采用清楚的提前返回，正常流程保持较浅嵌套。
- 可预期业务失败使用约定的结果；编程错误和不可恢复问题使用含上下文的异常，不能统一转换成无信息的 false。
- 不用空 catch 吞错；异常隔离的位置应与模块边界一致。
- 不将 `NullReferenceException` 当作通用“找不到类型”结果；选择能表达真实问题的契约。
- 发布版本仍应具有必要的故障诊断信息，不能把所有失败日志都编译掉。
- 平台条件编译保持局部且可读，避免在同一方法混杂大量不相干平台路径。

## 13. 不能作为规范继承的现有问题

以下是静态阅读发现的具体例子，未做运行复现；用于说明为什么不能直接复制全部旧写法。

| 位置 | 源码情况与影响 | 应确立的约束 |
| --- | --- | --- |
| [XCoroutine.cs:39](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XCoroutine.cs:39) | 两个停止入口在 `!core` 时调用 core；宿主存在时反而不停止 | 资源存在性判断与操作方向一致 |
| [XActionStateMachine.cs:180](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XActionStateMachine.cs:180) | PopState 使用 `stateList[count]` 和 `RemoveAt(count)`，非空时索引越界 | 栈末索引统一为 Count - 1 |
| [XPluginManager.cs](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XPluginManager.cs) | Type 版本忽略 Install 返回值；泛型版本安装失败后仍尝试取字典项；卸载重载调用阶段不一致 | 重载共享生命周期语义，失败不注册、不继续假定成功 |
| [XEventModule.cs:239](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XEventModule.cs:239) | 触发标志只在首次建键时设 true，后续已有 false 值时未重新置 true；不同取消订阅路径处理不一致 | 每次分发正确建立状态，统一延迟修改与异常恢复 |
| [XCoreCoroutine.cs:1](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XCoreCoroutine.cs:1) | Runtime 文件直接 using UnityEditor，程序集未限制 Editor | 排除播放器编译对 Editor API 的依赖；实际影响需玩家构建验证 |
| [XHotfixBox.cs](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/XHotfixBox.cs) | 每次 MessageBox 都 AddListener，未在该方法看到清理旧监听 | 反复显示不能积累本次操作的旧回调 |
| [XAppSdk.cs](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Sdk/XAppSdk.cs) | Login 遍历提供者后，即使都不受理也存在返回 true 的路径 | 返回值反映真实受理结果 |
| [SDK 请求实现示例](G:/My/u3dx/developments/v0/client/LocalPackages/com.oathx.core/Runtime/Sdk/XAppEmail.cs:63) | 网络实现存在空响应无完成回调、回调处于解析 catch 范围、未显式配置超时/释放等情况 | 完成路径闭合，解析异常与调用方异常分离 |

命名空间缺失、拼写不统一、Tab/空格混用、空 XML 文档也属于待统一事项，不应认定为刻意设计。

## 14. 新代码模板

以下示例表达建议统一后的声明和排版，并非从旧文件逐字复制。协议属性采用 PascalCase 加显式 JSON 映射；若维护原 DTO，也可以保留原 lowerCamelCase 名称。

```csharp
using System;
using Newtonsoft.Json;

namespace Oathx.Core.Sdk
{
    /// <summary>
    /// Describes a product returned by the remote service.
    /// </summary>
    public sealed class ProductInfo
    {
        [JsonProperty("productId")]
        public string ProductId
        {
            get;
            set;
        }
    }

    /// <summary>
    /// Provides access to the product catalog.
    /// </summary>
    public interface IProductCatalogAPI
    {
        /// <summary>
        /// Starts a catalog request on the Unity main thread.
        /// </summary>
        /// <param name="complete">
        /// Called exactly once on the main thread for an accepted request.
        /// The Boolean indicates operation success; the string contains
        /// the response on success or an error description on failure.
        /// </param>
        /// <returns>
        /// True if accepted; false if rejected without invoking the callback.
        /// </returns>
        bool GetProducts(Action<bool, string> complete);
    }
}
```

示例的回调保证必须由实现真正满足，不是写上注释就具备。若需要取消，应继续定义取消是否触发完成回调以及取消结果的表达方式。

## 15. 后续代码评审清单

- 命名空间、文件名和职责是否清楚，公开名称是否保持兼容？
- 是否使用一致缩进、Allman、显式访问级别和完整控制流大括号？
- 新普通属性与协议字段是否采用明确命名策略，序列化名称是否稳定？
- 接口、门面、实现、DTO 是否各自承担合理职责？
- 插件各阶段与失败回滚是否一致，重载是否语义相同？
- 事件与状态机是否处理重入、集合修改、空栈和异常恢复？
- 同步返回值、异步回调、广播次数和业务成功是否清楚区分？
- 请求是否覆盖超时、取消、空响应、解析失败与资源释放？
- Unity 对象、监听、定时器和协程是否有明确所有者与清理入口？
- Runtime 是否避免无保护的 UnityEditor 依赖？
- 注释是否解释真实约束，日志是否可诊断且不暴露凭据？
- 行为修改是否针对相关边界验证，而非只确认编译成功？

## 16. 与 GameCLI 规范的关系

这份报告适合用作风格与架构参考，不应整体覆盖 GameCLI 现有 C#/.NET 8 规范：

- 可以继承四空格与 Allman、接口隔离、插件生命周期、清楚的命名和职责划分。
- 不应把 Unity 协程、MonoBehaviour 单例、Newtonsoft.Json 或 DTO 小写属性强制推广到独立 CLI。
- GameCLI 当前要求 PascalCase 属性、nullable 检查、System.Text.Json，以及网络/进程操作的异步、超时和 CancellationToken，仍按其现有开发技能执行。
- 本次只新增分析文档，没有改动任何 SKILL.md、AGENTS.md、源码、纲要或 Git 提交。
