---
name: gameai-cli-development
description: 定义所有使用 GameCLI 的工程必须遵守的 C# 编码、排版和注释规范；用于这些工程的代码新增、修改、审查，以及 GameCLI 自身的开发与维护。
---

# Game CLI 工程开发约定

## 强制适用范围与执行要求

- 凡使用 GameCLI 的工程，今后开发、修改和审查其自有 C# 代码时，必须严格遵守本技能的编码、命名、排版和注释规范。这是强制开发要求，不是可选建议，适用范围不限于 GameCLI 自身仓库。
- 规范覆盖目标工程的业务代码、Unity Runtime/Editor 代码、工具、插件、命令和测试代码；人工开发与 AI Agent 生成或修改的代码执行相同标准。新类型不添加 `X` 前缀。
- 使用 GameCLI 的 AI 开发流程必须在编码前读取本技能。分发角色技能时必须同时携带本技能，保持同级目录引用有效；目标工程的 AGENTS.md 或等效 AI 工具入口必须明确引用本规范。
- 目标工程可补充业务约束和更严格的规则，但不得自行放宽或以旧代码风格替代本规范。遇到无法兼容的规则，明确指出冲突并由用户裁定，不静默选择较宽松规则。
- 开发者交付前必须自检，代码审查与 QA 必须核对本次新增和修改的代码；违反规范的代码不能判定通过。编译成功或功能测试通过不替代编码规范检查。
- 不因采用本规范擅自重写第三方依赖、自动生成文件或批量格式化未涉及的历史代码；不破坏序列化、协议与公开 API。修改范围内的自有代码必须达标，历史代码的整体治理另行安排。
- 下面的命名、排版、注释及通用实现要求适用于所有接入工程。GameCLI 专属目录、.NET 8 目标框架、CLI 接口、命令与 JIRA 流程约定仅适用于相应 GameCLI 组件，不要求接入工程迁移目录、框架或现有业务体系。

## 项目边界与入口

- 本节描述 ugame-ai-cli 自身的工程入口。先确认实际目标仓库；为接入工程工作时使用该工程路径，不因引用本技能或 Oathx 命名转到其他项目。
- 全部业务和工具实现使用 C#。独立 CLI 使用现有 .NET 8 工程，不恢复 Python 骨架。
- 从仓库根目录定位：`app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/GameCLI.sln`；其 `GameCLI/GameCLI.csproj` 为控制台入口工程。
- Unity 宿主为 `app/client`，当前 Unity 2022.3.62f2。Unity 代码遵守该版本的语言和 API 兼容性，不能直接套用 .NET 8 API。
- 保留既有目录和用户改动；配置路径从项目根、参数或配置解析，不将本机盘符写入可复用代码。

## C# 职责与实现约定

- `Program.cs` 负责启动和依赖组装；`Commands` 解析参数、调用用例并映射退出码，不承载业务流程。
- `Core` 放状态机与编排；`Contracts` 放 DTO、结果与显式校验；`Agents` 放四类业务角色调用适配；`Services` 放 JIRA、Git、资产与 Unity 执行器。按实际功能创建，不用空实现假装功能完成。
- 通过接口或构造参数注入外部依赖，使状态迁移和验证可独立测试。确定性调度逻辑不交给 LLM 自行决定。
- 所有 CLI 命令实现 `ICommand`，所有 CLI 插件实现 `ICLIPlugin`；沿用插件宿主统一处理 enable/disable，不在命令内绕过插件开关。
- 方法职责单一，优先用有名称的小方法表达业务步骤；参数或前置条件不满足时提前返回，减少嵌套。
- 类型和成员显式声明访问级别；仅暴露调用方确实需要的成员。引用不会重新赋值的字段使用 readonly，但不将其视为集合不可变或线程安全。
- 独立 CLI 保持 nullable 检查开启；Unity 代码遵循所在程序集的语言与 nullable 设置。不要用空 catch 或随意的 null-forgiving 掩盖失败，异常应保留操作上下文。
- 重载保持相同的成功、失败及清理语义；区分操作已受理与最终完成，异步结果和取消行为必须清楚。
- 网络和进程操作采用异步、超时及 CancellationToken；避免阻塞 `.Result`/`.Wait()`。进程参数使用结构化 ArgumentList，不拼接不可信 shell 命令。
- 为请求、进程、事件订阅和其他资源明确所有者及释放入口；成功、失败、取消路径均需清理。新增单例必须有实际的共享生命周期需求，不照搬参考工程的全局服务。
- 新依赖或框架必须有当前功能需求；保持现有目标框架，升级应单独说明兼容性影响。

## C# 命名规范

- 类型、方法、属性、事件、枚举及枚举成员使用 PascalCase；接口使用 `I` 前缀，例如 `ICommand`、`ICLIPlugin`。
- 新类型按职责命名，例如 `PluginHost`、`JiraClient`、`PingCommand`，不添加 `X` 前缀。已有外部类型或公开契约不为套用此规则擅自改名。
- 私有字段、参数和局部变量使用 camelCase；新增私有字段不添加 `_`、`m_` 等前缀。常量使用 PascalCase。
- 方法采用动词或动宾结构；布尔判断使用 `Is/Has/Can`，允许失败的尝试使用 `Try`，异步 Task 方法使用 `Async` 后缀。
- 常用名称采用 `Id`、`Url`、`Api` 等一致拼写；保留已有 `ICLIPlugin` 等约定名称，不进行无关的批量改名。
- DTO 的 C# 属性同样使用 PascalCase；通过 System.Text.Json 的命名策略或 `JsonPropertyName` 保持既有 JSON 字段名，不照搬参考工程的小写公开属性。
- 主文件名与主要类型名一致，命名空间反映所属模块；紧密关联的小型辅助类型可以同文件，独立复用的类型单独组织。
- 改名不得破坏 Unity 序列化字段、脚本 GUID、JSON 协议或公开 API；需要迁移时明确处理兼容性。

## C# 排版规范

- 使用四空格缩进，不使用 Tab；保留文件现有编码和换行符，避免仅因格式造成整文件差异。
- 使用 Allman 大括号：块式命名空间、类型、方法、控制流、多行 lambda 和非空初始化器的开始大括号独占一行。自动属性与空初始化器按下面的紧凑规则处理。新增文件使用块式命名空间。
- 所有 `if/else/for/foreach/while/do/using` 语句体均加大括号，即使只有一条语句；`using` 声明按正常声明排版。
- 每行只写一个字段或局部变量声明、一个语句；正常 `for` 头部除外，不串联多个赋值或业务动作。
- 没有访问器逻辑的属性必须采用两行格式：第一行是属性声明，第二行是 `{ get; set; }`，两行缩进相同。只读 `{ get; }`、`{ get; private set; }`、`{ get; init; }` 以及接口、抽象属性同样适用。禁止把声明和访问器合成一行，也禁止将纯自动访问器展开成多行。只有 get/set/init 包含方法体或表达式逻辑时才展开访问器；简短的表达式体属性可保留。
- 空数组、集合、对象和匿名对象初始化器必须写成同行的 `{}`，不得将空大括号拆行；紧接的调用结束括号和分号也不得单独换行，例如 `Array.AsReadOnly(new ICommand[] {});`。自动属性的这类初始化表达式跟随第二行访问器，完整属性仍只有两行。非空初始化器继续展开，空方法体和空控制流块仍遵守 Allman 规则。
- 成员之间、不同逻辑段之间留一个空行；同一字段的属性标记、XML 注释与声明保持相邻。
- 运算符两侧和逗号之后留空格；控制流关键字与左括号之间留空格，方法名与左括号之间不加空格。
- 长参数列表、初始化器和调用链按语义换行；不把多个初始化项挤在同一行，不为追求短代码压缩分支。
- `using` 放在文件顶部，按 System、外部依赖、项目命名空间分组，移除未使用引用。
- 右侧类型明确或使用匿名类型时可用 `var`；类型影响理解时显式声明。不为格式统一强行升级语法版本。
- 修改既有文件时规范新增和实际改动的代码；没有明确格式化任务时，不顺带重排整文件或重命名无关成员。

## C# 注释规范

- 源码注释使用简明英文；用户界面文案和交付说明不受此语言约定限制。
- 公共类型、接口和非显然的公开成员使用 XML 文档注释，说明职责与契约；简单自明的 DTO 属性不机械添加重复注释。
- `<summary>` 说明实际用途；参数存在约束时写 `<param>`，返回值含业务含义时写 `<returns>`，调用方需要处理的异常写 `<exception>`。不留空标签，不只复述名称。
- 接口文档写清成功与失败、取消行为、生命周期及数据归属；回调额外说明调用次数、线程和触发时机。不能在注释中承诺实现尚未保证的行为。
- 实现中的 `//` 解释为何如此处理，重点记录执行顺序、重入、幂等、资源所有权、恢复条件和非显然算法；不逐行翻译代码。
- 实现与接口契约完全一致时可用 `<inheritdoc />`；覆盖行为或增加限制时补充具体说明。
- 修改行为同步更新注释；不保留大段注释掉的旧代码，不用 TODO 或空实现冒充完成。

### 排版示例

自动属性带空初始化器时必须写成：

```csharp
public override IReadOnlyList<ICommand> Commands
{ get; } = Array.AsReadOnly(new ICommand[] {});
```

以下示例只展示命名、属性、构造方法和注释格式，不要求创建该类型：

```csharp
using System;

namespace GameCLI.Contracts
{
    /// <summary>
    /// Identifies the plugin that owns a command.
    /// </summary>
    public sealed class CommandOwner
    {
        public string PluginId
        { get; }

        /// <summary>
        /// Creates an owner with a nonempty plugin identifier.
        /// </summary>
        /// <exception cref="ArgumentException">
        /// The identifier is null, empty, or whitespace.
        /// </exception>
        public CommandOwner(string pluginId)
        {
            if (string.IsNullOrWhiteSpace(pluginId))
            {
                throw new ArgumentException("A plugin ID is required.", nameof(pluginId));
            }

            PluginId = pluginId;
        }
    }
}
```

## JIRA、编排和人工门禁

- JIRA 是任务状态、审批、重试和执行记录的唯一可信来源。不得引入 SQLite、本地 JSON 或另一数据库保存权威流程状态；产物与日志可以落盘。
- 每次执行读取 JIRA 的最新状态、依赖及审批，只执行定义明确且满足 guard 的迁移。JIRA 不可用时暂停，不能凭缓存推进。
- PM、Art、Dev、QA 使用结构化任务和结果交互，由编排器统一调度；技能是指令，不是已运行的 Agent 服务。
- 副作用前核对执行 ID/幂等键；超时或恢复时核对远端已有结果，不能将先查后写视为原子锁。
- 重试上限和结果回写 JIRA。默认最多 3 次，区分网络重试与业务修复；拒绝、权限失败、规则缺失或次数超限时返回明确原因。
- 人工批准绑定对应需求或产物版本。不得由 Agent 自批、以旧审批批准新产物，或在合并未完成时记录完成。

## CLI 契约与安全配置

- 命令按功能分组：`GameCLI <group> [options]`。当前使用 `GameCLI unity --ping --project <path> --format json`；后续 JIRA 能力归入 `GameCLI jira ...`。Program 只分发命令组，各组自行解析操作与参数；尚未实现的组明确报错，不提供假成功入口。

- 延续纲要退出码：0 成功、1 可重试错误、2 需修复错误、3 不可重试/需人工、4 输入契约错误、5 配置错误。
- 使用 C# DTO 和 System.Text.Json；显式校验必填字段、枚举、版本和任务依赖，不能仅以反序列化成功判定有效。
- 机器可读模式 stdout 只输出结构化结果，诊断写 stderr。记录 trace ID、issue key、输入版本和真实证据；不能伪造报告或把 stub 结果当真实验证。
- 令牌来自环境或适当凭据提供器；不写入源码、Skill、提交或日志。配置错误应指出缺失项，不回显秘密。

## Unity 与 Skill 分发

- 包内 `Editor` 放 UnityEditor、桥接和导入验证；`Runtime` 放可复用运行时契约。独立 CLI 留在 `GameCLI~`，不让 Unity 导入其源码。
- 资产变更保留已有 .meta GUID。不要为完成 CLI 工作重建用户场景或移动现有资产。
- 标准技能全部放在包根 `game-cli/<skill-name>/SKILL.md`，使用包含 name/description 的 YAML frontmatter，目录名与 name 一致。
- 五个角色技能与 common/jira/unity 公共技能保持职责边界。本开发技能负责工程约定，不增加第五个业务 Agent。
- 技能互引使用同级相对路径；分发时携带依赖，不能依赖开发机绝对路径。只按需增加 references、scripts、assets。
- 结构或契约变化同步 `Docs/structure.md` 与仓库 `docs/全AI流程规划纲要.html`，明确区分已实现与规划。

## 验证与交付

- Windows 使用 `pwsh.exe`。C# 改动构建现有解决方案：`dotnet build app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/GameCLI.sln --configuration Release`。
- 有测试后执行相关 `dotnet test`；优先覆盖状态迁移、重复事件、恢复、输入校验和退出码。尚无测试时明确说明，不把构建成功称为业务测试通过。
- 修改 Unity 行为时使用实际 Unity 入口验证；不存在的 Runner 或测试入口不得宣称通过。
- 修改技能检查 frontmatter、引用和未完成占位内容。纯说明调整执行必要检查，不为其编写镜像实现的测试。
- 提交前检查 diff 和文件清单。保留独立 CLI 的 .csproj/.sln；排除 Unity 生成工程、Library、Temp、Logs、UserSettings、bin、obj、.vs、构建产物和凭据。
- Git 提交与推送按用户授权执行，不默认 force push。连接失败先区分网络与鉴权，必要时读取实际系统代理并采用单次参数，不写死代理或擅改全局配置。
- 交付说明实际修改、验证结果和未完成事项；推送成功后报告真实提交号与目标分支。
