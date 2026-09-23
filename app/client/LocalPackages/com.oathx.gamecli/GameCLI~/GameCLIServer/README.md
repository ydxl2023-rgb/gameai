# GameCLIServer

Node.js 事件服务，接收 JIRA Webhook 并向 GameCLI Orchestrator 推送项目通知。需要 Node.js 22.9.0 或更高版本。

Windows 可双击本目录中的 `start.bat`。脚本自动切换到服务目录并检查 Node.js；首次缺少 `.env` 时复制模板并停止，请填写项目及JIRA 通知随机令牌后再次启动。缺少 `ws` 依赖时自动执行 `npm ci`，服务在当前窗口运行，按 Ctrl+C 停止。更新依赖锁文件后请重新执行 `npm ci`。

启动失败会保留窗口显示错误；从终端或自动化调用时可使用 `start.bat --no-pause` 禁用暂停并获取退出码。已有 `.env` 不会被覆盖，其余配置校验由服务负责。

```powershell
npm ci
Copy-Item .env.example .env
# 首次配置 .env 中JIRA 通知随机令牌及开放项目，再启动。
npm start
```

客户端通过 `orchestrator --connect --server <ws或wss地址>/ws --project-key <项目> --format json` 接收事件，局域网客户端连接不需要令牌。

完整方案、固定协议、配置、JIRA 接入与当前实现边界见仓库 [协调服务设计](../../../../../../docs/gamecli-server-architecture.md)。本版只实现通知通道，不进行集中派工或自动启动 Agent。

服务测试：`npm test`。先构建相邻 C# 工程的 Release 版本，再运行 `npm run test:cli` 进行跨语言联调。

控制台日志包含时间、监听地址、项目范围、通知接收与拒绝原因、尝试推送的客户端数量、客户端注册及断开。不会输出回调完整 URL、令牌或通知正文。推送数量为 0 表示当前没有可推送的该项目订阅连接，不代表通知未收到。窗口标题出现“选择”时，按 Esc 退出选择模式后再观察。

详细日志：HTTP 请求编号、来源地址、响应码与耗时；JIRA 单据编号、项目、事件类型、变更前后状态、通知编号与序号；客户端连接编号、订阅注册、恢复原因、补发数量、发送结果、断开码与在线时长。每 60 秒输出一次累计请求、通知处理及在线连接统计。发送完成只表示写入连接，不代表客户端已经处理。默认不逐条记录心跳；需要时在 `.env` 加入 `GAMECLI_LOG_HEARTBEATS=true` 并重启。来源地址为直接连接地址，经过代理时显示代理地址。日志输出到当前控制台。

ART 通知调度测试：先运行 `dotnet build ../GameCLI/Tests/GameCLI.DeliverySmoke --configuration Release`，再运行 `npm run test:probe`，覆盖真实 Node → WebSocket → C# 编排器传输、无关通知过滤、重复通知与代理运行期间心跳；JIRA 和代理采用测试替身。真实 Codex 会话通过 `orchestrator --art-probe` 单独验证。
