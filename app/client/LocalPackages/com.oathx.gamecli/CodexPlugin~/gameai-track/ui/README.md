# GameAI Track 组件化工作台

React 19.3.0、TypeScript、Ant Design 6.6.5。版本由 package-lock.json 锁定；只采用基础组件，不依赖 Ant Design Pro 或在线 CDN。

## 当前范围

单项目七页、紧凑统计、任务筛选搜索、详情抽屉、版本审阅、模拟批准和退回原因、模拟权限配置、操作记录、可拖动 Output，以及现有 MCP 内嵌/侧栏模式。

已接入 PostgreSQL：项目、版本、任务、依赖、Agent 与审计从库读取，当前导入的是明确标记的测试数据。数据库模式禁用模拟身份、审批和授权修改。独立 demo 模式仍允许仅当前页面的演示操作。尚未接入正式登录、派工或 Agent 执行。

## 安装与构建

在包内 `GameCLI~/GameCLIServer` 目录执行：

```text
npm ci
npm run setup:track
npm run build:track
npm run test:track
```

`start-track.bat` 也会安装服务端和 UI 的锁定依赖并启动预览。默认端口 8090，可在当前终端设置 `GAMECLI_TRACK_PORT`；本次验证采用 18090。

构建保留 esbuild，打包 JS/CSS 为自包含 `public/track.html`。React 和 Ant Design 在构建时解析，运行时无需外部网络。不要提交 node_modules、public 或 dist。

## 模块

- `src/App.tsx`：工作台页面、内存演示状态和交互。
- `src/components.tsx`：共享表格与状态控件。
- `src/model.ts`：快照契约、校验、审批权限判断。
- `src/bridge.ts`：MCP 桥接和只读 HTTP 快照适配。
- `src/styles.css`：业务布局与紧凑响应式样式。
- `test/workbench.test.mjs`：契约、宿主模式及实际 React bundle 交互测试。

仅离线演示与首次种子导入使用服务端 `src/track/workbench.json`。快照协议为 2，组件资源为 `ui://gameai-track/v3.html`。旧 MCP 进程持有旧资源，需要重新加载 MCP 或重启 Codex；浏览器预览成功不替代宿主内嵌验收。

## 开发边界

下一阶段增加真实身份和业务写接口时，不把本页 identity 下拉框或内存权限当作安全机制。现有只读 MCP 工具不拥有审批权限。
