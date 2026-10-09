# 已停用的 Unity CLI 桥接

旧 GameCLI 的内置 Unity 插件、客户端与管道测试保留用于回查，不参与 `src/GameAI.Cli/GameCLI.sln` 编译或运行。

新平台使用独立外部 Unity CLI。此处旧测试依赖原桥接，不能当作当前平台的验证入口；当前独立 CLI 验证使用 `src/GameAI.Cli/Tests/GameCLI.PluginSmoke`。
