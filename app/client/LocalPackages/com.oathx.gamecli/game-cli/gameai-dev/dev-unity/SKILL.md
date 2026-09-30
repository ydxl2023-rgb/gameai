---
name: dev-unity
description: 实现或修复 Unity 项目的授权功能。用于Unity 开发专业任务，与所属主技能共同使用。
---

# Unity 开发

执行前读取 [所属主技能](../SKILL.md)，遵守其审批、公共契约、交付和结果格式。仅承担本专业职责；跨专业事项说明所需交付及依赖，交由云编排器协调，不自行启动其他 Agent。

## 专业要求

- 核对项目 Unity 版本与可用工具，分离 Editor 与 Runtime，保留资源 GUID；按下面的 Unity 验证规则检查编译和目标行为。
- 以已批准的任务和交付标准为范围；未确定的规则交回策划，不以个人推断替代批准版本。
- 交付实际文件、版本及验证证据；工具不可用时明确报告阻塞，不编造执行结果。

## 交付边界

只返回本专业结果，由主技能汇总或按宿主 schema 提交。技能目录本身不创建固定 Agent，不授予审批或派工权限。

<a id="unity-validation"></a>

## Unity 验证

本节供 Development 与 QA 共用。QA 引用本节时仅执行验收，不承担开发职责，也不加载开发主技能。

- 核对项目路径、Unity 精确版本、Commit、Packages 锁文件、资产 Hash 与验证入口。
- 只调用实际存在的 CLI/Editor 方法；纲要中的 Automation.CI.RunAll 尚未实现时不能宣称验证通过。
- 为每次执行建立独立产物目录，记录命令、退出码、超时和日志，避免复用旧报告。
- 按任务执行编译、EditMode/PlayMode 测试或构建，按实际 NUnit/JUnit XML 格式解析结果。
- 同时检查进程退出码、编译错误和测试失败；报告缺失、崩溃、超时或零测试不能自动判定验收通过。
- 视觉验证需要适当图形环境，无图形模式成功不能代替截图验证。
- 使用隔离工作区或协调同一工程的编辑器访问，保护已有场景修改；保留 .meta，不提交 Library、Temp、Logs、UserSettings 或构建输出。

输出执行模式 real/stub、Unity 版本、Commit、BuildID、退出码、测试数量、失败项、日志/截图/报告路径及构建 Hash。Runner 不存在时返回 blocked，桩结果必须标记 stub。
