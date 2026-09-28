@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
call npm.cmd ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 goto failed
call npm.cmd run build:track
if errorlevel 1 goto failed
call npm.cmd run start:track
set "trackExitCode=%errorlevel%"
popd
exit /b %trackExitCode%
:failed
popd
exit /b 1
