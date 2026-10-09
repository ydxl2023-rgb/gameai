# 独立 GameAI 平台目录

平台运行不依赖 Unity 安装或 Unity 包源码。

| 路径 | 用途 |
| --- | --- |
| `game-cli/src/GameAI.Cli/GameCLI.sln` | C#/.NET 8 CLI，现有命令仍为 GameCLI |
| `game-cli/src/GameAI.Server` | Node.js 编排器、PostgreSQL 接口与 Track 服务 |
| `game-cli/plugins/gameai-track` | Codex 插件、初稿技能与 Track UI |
| `game-cli/skills` | Design、PM、Prefab、Art、Development、QA 及公共技能 |
| `app/desgin` | 正式策划 HTML 与审阅产物 |
| `app/client` | 独立 Unity 目标工程，不再安装 GameAI 平台包 |
| `legacy/unity-bridge` | 已退出编译和插件注册的旧 CLI 桥接及旧测试，仅供历史回查 |

旧 Editor/Runtime 包文件已归档到 `legacy/unity-bridge/Package`；包已从 Unity 的 manifest 与 lock 中解除，不是平台入口。不得继续使用旧安装器。

## 启动与验证

在仓库根目录编译 CLI：`dotnet build game-cli/src/GameAI.Cli/GameCLI.sln -c Release`。

服务目录下执行 `npm ci`、`npm run setup:track`、`npm run build:track`，然后 `npm run start:track`。现有本机 `.env*` 配置随服务迁移，仍被 Git 忽略；不重建数据库或固定 Agent。技能变更后执行 `npm run db:sync-skills`。

默认目标工程为平台仓库；服务可使用 `GAMEAI_PROJECT_ROOT` 指定目标工程，必须包含其 `.gamecli/client.json` 连接配置。服务从平台位置加载 CLI 和技能，目标工程位置用于任务工作区及产物。CLI `--project` 明确目标工程，`--skills` 或 `GAMEAI_SKILLS_DIR` 可覆盖技能位置；默认从 CLI 所在平台查找 `game-cli/skills/`，不再搜索 Unity 包。

Codex MCP 启动入口为 `game-cli/src/GameAI.Server/dist/track/stdio.js`，更新路径后需重新连接插件以重启既有 MCP 进程。Track HTTP 地址保持不变。

Unity 由外部 Unity CLI 操作。Prefab/Development/QA 必须使用目标工程实际配置的工具；未接通时报告阻塞，不调用已停用的 GameCLI Unity bridge。本次目录迁移不代表外部 Unity CLI 已完成预制件生产验证。

## 生产中间文件

`game-cli/temp/` 保存 PM/任务执行输入、诊断日志、Agent 临时结果、Design 提交载荷与回执，按执行编号隔离并默认忽略 Git。正式策划 HTML 仍在 `app/desgin/`，最终交付不作为临时文件清理。`.gamecli/client.json` 仍为目标工程连接配置。平台默认目标工程是 `game-cli/` 的父目录，可通过 `GAMEAI_PROJECT_ROOT` 指定其他工程。
