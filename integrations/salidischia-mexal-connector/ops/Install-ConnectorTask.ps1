param([switch]$Activate)
$ErrorActionPreference = 'Stop'
$connectorRoot = Split-Path -Parent $PSScriptRoot
$connectorConfig = Get-Content -LiteralPath (Join-Path $connectorRoot '.private\connector-config.json') -Raw | ConvertFrom-Json
if ($Activate -and -not $connectorConfig.cutoverVerified) { throw 'Passaggio del sito non verificato. Attivazione negata.' }
$connectorIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$connectorAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}"' -f (Join-Path $connectorRoot 'ops\Run-Connector.ps1')) -WorkingDirectory $connectorRoot
$connectorTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5)
$connectorPrincipal = New-ScheduledTaskPrincipal -UserId $connectorIdentity -LogonType Interactive -RunLevel Limited
$connectorSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$connectorTask = New-ScheduledTask -Action $connectorAction -Trigger $connectorTrigger -Principal $connectorPrincipal -Settings $connectorSettings -Description 'Trasferisce ordini in Mexal e sincronizza listino 1 e disponibilita magazzino 5 sul sito. Nessuna password negli argomenti. Richiede sessione Windows utente attiva, anche con RDP disconnessa.'
Register-ScheduledTask -TaskName 'SaliDiIschia-Mexal-Connector' -InputObject $connectorTask -Force | Out-Null
if (-not $Activate) { Disable-ScheduledTask -TaskName 'SaliDiIschia-Mexal-Connector' | Out-Null }
Get-ScheduledTask -TaskName 'SaliDiIschia-Mexal-Connector' | Select-Object TaskName,State
