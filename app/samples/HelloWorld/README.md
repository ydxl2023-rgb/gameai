# Hello World 独立控制台示例

任务 P-0000195，需求 HELLO-WORLD v1.0。程序只输出一行 `Hello World!`，随后自行退出。

环境：Windows、PowerShell 7（`pwsh.exe`）、现有 .NET SDK 9.0.314，目标框架 `net8.0`。依赖框架发布需要同架构的 Microsoft.NETCore.App 8.0 运行时；SDK 已安装不代表运行时齐备。本次环境详情见 `reports/build.log`。

以下命令均从仓库根目录执行：

```pwsh
dotnet --version
dotnet --list-runtimes
dotnet publish app/samples/HelloWorld/HelloWorld.csproj -c Release --no-self-contained -o Artifacts/hello-world/publish
.\Artifacts\hello-world\publish\HelloWorld.exe
```

不需要输入、第三方包、应用配置或服务。发布目录必须完整保留，不能只复制 exe。实际文件清单和 SHA-256 见 `reports/publish-manifest.json`，构建原始输出见 `reports/build.log`，开发自检见 `reports/self-check.json`。

局部 `.gitignore` 解除此工程文件的忽略；bin/obj 和仓库根 Artifacts 发布产物保持忽略，但实际发布文件交付宿主。本次不提交、不推送。开发自检不替代后续 QA 两次独立启动和人工最终验收。
