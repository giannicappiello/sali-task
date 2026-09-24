param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$root = 'C:\AssistenteAI\Coordinator'
$configuration = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if (([Uri]$configuration.workspaceUrl).Scheme -ne 'https') { throw 'Workspace deve usare HTTPS.' }
if (-not (Test-Path -LiteralPath $configuration.nodeExecutable -PathType Leaf)) { throw 'Eseguibile Node non trovato.' }
if ($configuration.PSObject.Properties.Name -contains 'token') { throw 'La configurazione non deve contenere credenziali in chiaro.' }
New-Item -ItemType Directory -Path $root -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$allowedSids = @($identity.User.Value,'S-1-5-18','S-1-5-32-544')
# icacls changes only the DACL; Set-Acl can request audit privileges on an existing directory.
& icacls.exe $root '/inheritance:r' '/grant:r' "*$($identity.User.Value):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Impossibile proteggere la cartella del coordinatore.' }
foreach ($rule in (Get-Acl -LiteralPath $root).Access) {
  $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($sid -notin $allowedSids) {
    & icacls.exe $root '/remove' "*$sid" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Impossibile rimuovere un accesso non previsto.' }
  }
}
foreach ($file in @('worker.mjs','worker-paths.mjs','source-discovery.mjs','publisher.mjs','Start-Worker.ps1','Pair-Worker.ps1')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $root $file) -Force
}
$configuration | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $root 'config.json') -Encoding UTF8
Write-Output 'Coordinatore installato. Associare la credenziale con Pair-Worker.ps1 prima di avviarlo.'
