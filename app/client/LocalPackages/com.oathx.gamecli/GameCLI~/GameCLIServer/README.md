# GameCLIServer

Node.js 事件服务，接收 JIRA Webhook 并向 GameCLI Orchestrator 推送项目通知。需要 Node.js 22.9.0 或更高版本。

```powershell
npm ci
Copy-Item .env.example .env
# 首次配置 .env 中两个不同的随机令牌及开放项目，再启动。
npm start
```

客户端通过 `orchestrator --connect --server <ws或wss地址>/ws --project-key <项目> --format json` 接收事件，凭据通过 `GAMECLI_SERVER_TOKEN` 环境变量提供。

完整方案、固定协议、配置、JIRA 接入与当前实现边界见仓库 [协调服务设计](../../../../../../docs/gamecli-server-architecture.md)。本版只实现通知通道，不进行集中派工或自动启动 Agent。

服务测试：`npm test`。先构建相邻 C# 工程的 Release 版本，再运行 `npm run test:cli` 进行跨语言联调。
