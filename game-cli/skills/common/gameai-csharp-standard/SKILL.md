---
name: gameai-csharp-standard
description: 接入工程自有 C# 代码的命名、排版和注释规范；用于开发、Prefab 涉及代码时及 QA 代码检查，不包含平台维护职责。
---

# C# 编码规范

仅在新增、修改或检查自有 C# 代码时应用。保留序列化字段、公开协议和资源 GUID；不批量重写第三方、生成文件或无关历史代码。目标工程可补充更严格规范；冲突须明确报告。功能测试不能代替代码规范检查。

## C# 命名规范

- 类型、方法、属性、事件、枚举及枚举成员使用 PascalCase；接口使用 `I` 前缀，例如 `ICommand`、`ICLIPlugin`。
- 新类型按职责命名，例如 `PluginHost`、`PlatformClient`、`PingCommand`，不添加 `X` 前缀。已有外部类型或公开契约不为套用此规则擅自改名。
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


## 实现约定

- 方法职责单一，使用命名清楚的小方法；类型及成员显式声明访问级别。
- 明确资源所有者及释放入口；成功、失败和取消均清理资源。网络和进程操作使用异步、超时和取消，避免阻塞等待。
- 进程参数使用结构化 ArgumentList，不拼接不可信 shell 命令。不用空 catch 或 null-forgiving 掩盖失败。
- 遵循目标框架和 nullable 配置，不把 .NET 8 API 直接用于 Unity；新增框架依赖需实际需求。
