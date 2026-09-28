@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node.exe >nul 2>&1
if errorlevel 1 goto failed
where npm.cmd >nul 2>&1
if errorlevel 1 goto failed
if not exist "node_modules\typescript\package.json" (
    call npm.cmd ci --ignore-scripts --no-audit --no-fund
    if errorlevel 1 goto failed
)
if not exist "..\..\CodexPlugin~\gameai-track\ui\node_modules\antd\package.json" (
    call npm.cmd run setup:track
    if errorlevel 1 goto failed
)
echo 正在构建并启动 GameCLIServer，按 Ctrl+C 停止服务。
call npm.cmd start
set "serverExitCode=%errorlevel%"
popd
if not "%serverExitCode%"=="0" if /i not "%~1"=="--no-pause" pause
exit /b %serverExitCode%
:failed
echo 启动失败，请检查 Node.js、npm、数据库配置及上方错误。
popd
if /i not "%~1"=="--no-pause" pause
exit /b 1
