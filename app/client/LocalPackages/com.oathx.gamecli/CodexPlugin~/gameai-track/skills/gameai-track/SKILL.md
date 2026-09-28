---
name: gameai-track
description: 打开和验证 GameAI Track 的 MCP UI 模拟面板；不涉及生产任务或审批。
---

# GameAI Track 接入验证

用户要求打开 GameAI Track 时，调用 gameai_track_open 展示组件。
刷新数据调用 gameai_track_snapshot。所有 DEMO 任务均为模拟，不得称为真实 JIRA 状态。
UI 未渲染时明确说明仅工具调用成功，不能把网页预览或 JSON 当作 Codex 组件渲染验收通过。
本阶段不能创建 JIRA 单据、批准需求或启动 Agent。
本地 MCP 由 Codex 使用 stdio 自动启动，不依赖 8090 HTTP 预览服务。首次在 GameCLIServer 中执行 npm ci、npm run build:track，再通过 pwsh.exe -File scripts/register-codex-track.ps1 注册。连接失败先核对进程启动日志与构建路径，不以浏览器预览代替 MCP 检查。
