@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
set "serverExitCode=1"

pushd "%~dp0"
if errorlevel 1 goto directory_failed

where node.exe >nul 2>&1
if errorlevel 1 (
    echo 未找到 Node.js，请安装 22.9.0 或更高版本后重新启动。
    goto failed
)

node.exe -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 9) ? 0 : 1);"
if errorlevel 1 (
    echo Node.js 版本过低，需要 22.9.0 或更高版本。
    goto failed
)

if not exist ".env" (
    copy /b ".env.example" ".env" >nul
    if errorlevel 1 (
        echo 无法创建 .env，请检查配置模板及目录写入权限。
        goto failed
    )
    echo 已创建 .env，请用文本编辑器打开并配置项目及JIRA 通知随机令牌。
    echo 令牌应为 32 至 256 位字母、数字、下划线或短横线，填写后再次运行本脚本。
    goto failed
)

if not exist "node_modules\ws\package.json" (
    where npm.cmd >nul 2>&1
    if errorlevel 1 (
        echo 未找到 npm，请检查 Node.js 安装及 PATH 配置。
        goto failed
    )
    echo 正在按锁文件安装服务依赖……
    call npm.cmd ci --ignore-scripts --no-audit --no-fund
    if errorlevel 1 (
        echo 依赖安装失败，请检查网络及上方错误信息。
        goto failed
    )
)

echo 正在启动 GameCLIServer，按 Ctrl+C 停止服务。
node.exe --env-file-if-exists=.env src/index.js
set "serverExitCode=%errorlevel%"
if not "%serverExitCode%"=="0" (
    echo 服务启动失败或异常退出，请检查上方错误及 .env 配置。
    goto failed
)
popd
exit /b 0

:failed
popd
goto finish

:directory_failed
echo 无法进入 GameCLIServer 目录。

:finish
if /i not "%~1"=="--no-pause" pause
exit /b %serverExitCode%
