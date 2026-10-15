param(
    [Parameter(Mandatory = $true)]
    [string]$Server,
    [string]$User = 'root',
    [string]$IdentityFile
)

$ErrorActionPreference = 'Stop'
$sshArguments = @(
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-L', '127.0.0.1:15439:127.0.0.1:5432',
    '-L', '127.0.0.1:16339:127.0.0.1:6333',
    '-L', '127.0.0.1:11439:127.0.0.1:11434'
)
if ($IdentityFile)
{
    $sshArguments += @('-i', (Resolve-Path -LiteralPath $IdentityFile).Path)
}
$sshArguments += "$User@$Server"
Write-Host 'Opening loopback-only PostgreSQL, Qdrant and embedding tunnels. Keep this terminal running.'
& ssh @sshArguments
exit $LASTEXITCODE
