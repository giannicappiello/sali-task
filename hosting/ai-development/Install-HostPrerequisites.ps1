# Installs only Microsoft's WSL runtime; never restarts the PC or launches an agent.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ResultDirectory)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Aprire questo script con privilegi amministrativi.'
}
$resultPath = [IO.Path]::GetFullPath($ResultDirectory)
New-Item -ItemType Directory -Path $resultPath -Force | Out-Null
$result = @{ startedAt = [DateTime]::UtcNow.ToString('o'); state = 'running'; automaticRestart = $false }
$statusFile = Join-Path $resultPath 'wsl-install-status.json'
$result | ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding UTF8
try {
    & "$env:SystemRoot\System32\wsl.exe" --install --no-distribution --web-download 2>&1 |
        Out-File -LiteralPath (Join-Path $resultPath 'wsl-install.log') -Encoding UTF8
    $result.exitCode = $LASTEXITCODE
    $result.state = if ($LASTEXITCODE -in @(0,3010)) { 'installed_runtime_verification_required' } else { 'failed' }
} catch {
    $result.state = 'failed'
    $result.error = $_.Exception.Message
} finally {
    $result.finishedAt = [DateTime]::UtcNow.ToString('o')
    $result | ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding UTF8
}
