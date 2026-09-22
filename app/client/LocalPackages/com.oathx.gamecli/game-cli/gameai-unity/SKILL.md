---
name: gameai-unity
description: 运行实际可用的 Unity 编译测试构建入口并解析报告；用于开发、QA 与编排器验证。
---

# Unity 验证

- 核对项目路径、Unity 精确版本、Commit、Packages 锁文件、资产 Hash 与验证入口。
- 只调用实际存在的 CLI/Editor 方法；纲要中的 Automation.CI.RunAll 尚未实现时不能宣称验证通过。
- 为每次执行建立独立产物目录，记录命令、退出码、超时和日志，避免复用旧报告。
- 按任务执行编译、EditMode/PlayMode 测试或构建，按实际 NUnit/JUnit XML 格式解析结果。
- 同时检查进程退出码、编译错误和测试失败；报告缺失、崩溃、超时或零测试不能自动判定验收通过。
- 视觉验证需要适当图形环境，无图形模式成功不能代替截图验证。
- 使用隔离工作区或协调同一工程的编辑器访问，保护已有场景修改；保留 .meta，不提交 Library、Temp、Logs、UserSettings 或构建输出。

输出执行模式 real/stub、Unity 版本、Commit、BuildID、退出码、测试数量、失败项、日志/截图/报告路径及构建 Hash。Runner 不存在时返回 blocked，桩结果必须标记 stub。
