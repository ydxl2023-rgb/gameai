#requires -Version 7.0
[CmdletBinding()]
param([int]$LegacyProcessId = 0)

$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path $PSScriptRoot -Parent
$platformRoot = Split-Path (Split-Path $serverRoot -Parent) -Parent
$logDirectory = Join-Path $platformRoot 'temp/track-start'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$entryPoint = Join-Path $serverRoot 'dist/track/demo.js'
if (!(Test-Path -LiteralPath $entryPoint)) { throw 'Build Track first: npm run build:track' }

# Only replace the explicitly identified legacy listener; never kill arbitrary Node processes.
if ($LegacyProcessId -gt 0)
{
    $legacyProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $LegacyProcessId"
    if ($legacyProcess)
    {
        $legacyListener = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
        if ($legacyProcess.Name -ne 'node.exe' -or $legacyProcess.CommandLine -notmatch 'dist[/\\]track[/\\]demo\.js' -or $legacyListener.OwningProcess -notcontains $LegacyProcessId)
        {
            throw 'Legacy PID no longer matches the known Track listener. Nothing was stopped.'
        }
        Stop-Process -Id $LegacyProcessId -ErrorAction Stop
    }
}

$listener = Get-NetTCPConnection -LocalPort 18090 -State Listen -ErrorAction SilentlyContinue
if (!$listener)
{
    # Child inherits these values; no PowerShell 7.4-only Start-Process parameters are needed.
    $env:GAMECLI_TRACK_PORT = '18090'
    $env:GAMEAI_TRACK_ORIGIN = 'http://127.0.0.1:18090'
    $runLabel = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $outputLog = Join-Path $logDirectory "$runLabel.stdout.log"
    $errorLog = Join-Path $logDirectory "$runLabel.stderr.log"
    $process = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $entryPoint + '"') -WorkingDirectory $serverRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
    Write-Host "Track PID: $($process.Id). Logs: $logDirectory"
}

for ($attempt = 0; $attempt -lt 20; $attempt++)
{
    try
    {
        $snapshot = Invoke-RestMethod 'http://127.0.0.1:18090/api/track/snapshot' -TimeoutSec 2
        $history = Invoke-RestMethod 'http://127.0.0.1:18090/api/track/collaboration' -TimeoutSec 2
        if (!$snapshot.workbench -or $null -eq $history.messages) { throw 'Unexpected API response.' }
        Write-Host 'Ready: http://127.0.0.1:18090/track'
        exit 0
    }
    catch
    {
        if ($process -and $process.HasExited)
        {
            if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Tail 20 }
            throw "Track exited. Check logs in $logDirectory"
        }
        Start-Sleep -Milliseconds 500
    }
}
throw "Track did not pass API checks. Check $logDirectory"
