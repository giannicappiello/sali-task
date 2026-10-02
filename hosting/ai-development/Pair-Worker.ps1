$ErrorActionPreference = 'Stop'
$root = 'C:\AssistenteAI\Coordinator'
if (-not (Test-Path -LiteralPath (Join-Path $root 'config.json'))) { throw 'Installare prima il coordinatore.' }
$token = Read-Host 'Credenziale mostrata in Impostazioni AI (input protetto)' -AsSecureString
$token | Export-Clixml -LiteralPath (Join-Path $root 'credential.xml')
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$launcher = Join-Path $root 'Start-Worker-Hidden.vbs'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Avvio nascosto mancante: reinstallare il coordinatore.' }
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') -Argument "//B //NoLogo `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Workspace AssistenteAI' -Action $action -Trigger @($trigger, $watchdog) -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'Workspace AssistenteAI'
Write-Output 'Servizio associato e avviato per questo utente Windows.'
