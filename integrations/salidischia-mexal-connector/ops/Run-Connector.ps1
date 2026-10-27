$ErrorActionPreference = 'Stop'
$connectorRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $connectorRoot
$connectorNode = (Get-Command node.exe -ErrorAction Stop).Source
$connectorLog = Join-Path $connectorRoot 'output\connector-service.log'
New-Item -ItemType Directory -Path (Join-Path $connectorRoot 'output') -Force | Out-Null
Add-Content -LiteralPath $connectorLog -Value ("[{0}] Avvio sincronizzazione" -f [DateTime]::UtcNow.ToString('o'))
& $connectorNode '--env-file=.env.local' 'scripts/run-once.mjs' '--write' 2>&1 | Out-File -LiteralPath $connectorLog -Append -Encoding utf8
$connectorExitCode = $LASTEXITCODE
Add-Content -LiteralPath $connectorLog -Value ("[{0}] Esito {1}" -f [DateTime]::UtcNow.ToString('o'), $connectorExitCode)
exit $connectorExitCode
