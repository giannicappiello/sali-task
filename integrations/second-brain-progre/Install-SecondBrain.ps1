param([Parameter(Mandatory=$true)][string]$SupabaseUrl,[Parameter(Mandatory=$true)][string]$SupabaseAnonKey)
$ErrorActionPreference='Stop'
$node=(Get-Command node.exe -ErrorAction Stop).Source
$root=$PSScriptRoot
$configPath=Join-Path $root 'config.json'
@{workspaceUrl='https://workspace.progre.it';supabaseUrl=$SupabaseUrl.TrimEnd('/');supabaseAnonKey=$SupabaseAnonKey} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
$scriptPath=(Join-Path $root 'src/server.mjs').Replace('\','/')
$configTomlPath=$configPath.Replace('\','/')
$nodePath=$node.Replace('\','/')
Write-Output 'Aggiungi questo blocco nelle impostazioni MCP di Codex sul TUO PC:'
Write-Output "[mcp_servers.second_brain_progre]"
Write-Output "command = '$nodePath'"
Write-Output "args = ['$scriptPath', '--config', '$configTomlPath']"
Write-Output 'Avvia una nuova chat, usa BRAIN_LOGIN e accedi personalmente nella pagina locale. Non copiare session.dpapi sull’altro PC.'
