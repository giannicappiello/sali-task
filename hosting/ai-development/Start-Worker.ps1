$ErrorActionPreference = 'Stop'
$root = 'C:\AssistenteAI\Coordinator'
$config = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
$credential = Import-Clixml -LiteralPath (Join-Path $root 'credential.xml')
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential)
try {
  $config | Add-Member -NotePropertyName token -NotePropertyValue ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) -Force
  $config | ConvertTo-Json -Depth 12 -Compress | & $config.nodeExecutable (Join-Path $root 'worker.mjs') -
  if ($LASTEXITCODE -ne 0) { throw "Il servizio ha terminato con codice $LASTEXITCODE" }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $config.token = $null
}
