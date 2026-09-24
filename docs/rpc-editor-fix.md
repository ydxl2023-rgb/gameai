# RPC 编辑器面板修复

本地包 `app/client/LocalPackages/com.oathx.rpc` 基于原 Git 包版本 1.17.0，来源为 https://gitee.com/oathxv/com.oathx.rpc.git ，原提交为 `3b910ece17b62af9e4ef07d1a721c25356749086`。保留原文件及资源 GUID，工程 manifest 和锁文件改为本地引用，避免修复随 PackageCache 清理丢失。

仅修改 `Editor/Inspector/XRpcInspectorWindow.cs`：固定初始化 Http、Tcp、Web 分页和空树根；显示未配置、未发现方法或缺失程序集提示；提供刷新和设置入口；同时解析程序集名称与 asmdef 声明名称，过滤空引用并去重；刷新时重建数据，避免旧配置残留。

RPC 面板只追踪该库的 RPC 方法，不会自动接管 GameCLI 的 WebSocket 或命名管道。

使用 Unity 2022.3.62f2 独立批处理工程验证：空配置、缺失程序集、无 RPC 方法、程序集去重、仅 asmdef 配置、重复刷新，以及清空配置后的旧数据清除。验证退出码为 0。尚未做可视化交互验收。

本地包仍沿用宿主已有的 Newtonsoft.Json、LitJson 和 Mono.Cecil 插件依赖；本次没有升级或替换这些插件。后续升级上游 RPC 包时应保留或重新应用本修复。
