$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$entryPath = Join-Path $serverRoot 'dist/track/stdio.js'
$widgetPath = Join-Path $serverRoot 'public/track.html'
if (-not (Test-Path -LiteralPath $entryPath) -or -not (Test-Path -LiteralPath $widgetPath))
{
    throw '尚未构建测试组件。请先在 GameCLIServer 中执行 npm ci、npm run setup:track 和 npm run build:track。'
}
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$codexCommand = Get-Command codex -ErrorAction Stop
# Codex starts and owns the local probe; no temporary HTTP process or proxy is required.
& $codexCommand.Source mcp add gameai-track -- $nodeCommand.Source $entryPath
if ($LASTEXITCODE -ne 0)
{
    throw 'Codex MCP 注册失败。'
}
& $codexCommand.Source mcp get gameai-track
if ($LASTEXITCODE -ne 0)
{
    throw 'Codex MCP 配置读取失败。'
}
Write-Host '注册完成：Codex 将自动启动本地 MCP，无需手动启动 8090 服务。'
Write-Host '已启动且握手失败的对话需要重新加载 MCP 配置。工具发现成功仍不等于内嵌 UI 已通过验收。'
