param([string]$SupabaseUrl,[string]$SupabaseAnonKey)
$ErrorActionPreference='Stop'
$node=(Get-Command node.exe -ErrorAction Stop).Source
$root=$PSScriptRoot
$configPath=Join-Path $root 'config.json'
if ($SupabaseUrl -and $SupabaseAnonKey) {
  @{workspaceUrl='https://workspace.progre.it';supabaseUrl=$SupabaseUrl.TrimEnd('/');supabaseAnonKey=$SupabaseAnonKey} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
} elseif (-not (Test-Path -LiteralPath $configPath)) {
  throw 'config.json mancante: utilizzare il pacchetto aziendale oppure specificare SupabaseUrl e SupabaseAnonKey pubblica.'
} elseif ($SupabaseUrl -or $SupabaseAnonKey) {
  throw 'Specificare entrambi i parametri oppure nessuno.'
}
$nodeMajor=[int]((& $node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Occorre Node.js 22 o successivo.' }
$scriptPath=(Join-Path $root 'src/server.mjs').Replace('\','/')
$configTomlPath=$configPath.Replace('\','/')
$nodePath=$node.Replace('\','/')
$codexCommand=Get-Command codex.exe -ErrorAction SilentlyContinue
$codexPath=if ($codexCommand) { $codexCommand.Source } else {
  Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin/*/codex.exe') -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ($codexPath) {
  & $codexPath mcp add second_brain_progre -- $nodePath $scriptPath --config $configTomlPath
  if ($LASTEXITCODE -ne 0) { throw 'Registrazione Codex non completata.' }
  Write-Output 'Second Brain Progre registrato nel profilo Codex di questo utente.'
} else {
  Write-Output 'Codex CLI non trovato. Aggiungi questo blocco nelle impostazioni MCP di Codex sul TUO PC:'
  Write-Output "[mcp_servers.second_brain_progre]"
  Write-Output "command = '$nodePath'"
  Write-Output "args = ['$scriptPath', '--config', '$configTomlPath']"
}
Write-Output 'Avvia una nuova chat, usa BRAIN_LOGIN e accedi personalmente nella pagina locale. Non copiare session.dpapi sull’altro PC.'
