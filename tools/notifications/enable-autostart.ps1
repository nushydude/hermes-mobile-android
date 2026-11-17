$ErrorActionPreference = 'Stop'
$notifyLauncher = Join-Path $PSScriptRoot 'start-ntfy.ps1'
$notifyRunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$notifyRunName = 'HermesMobileNtfy'
$notifyCommand = '"' + (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') + '" -NoProfile -WindowStyle Hidden -File "' + $notifyLauncher + '"'
$notifyExisting = (Get-ItemProperty -LiteralPath $notifyRunKey -Name $notifyRunName -ErrorAction SilentlyContinue).$notifyRunName
if ($notifyExisting -and $notifyExisting -ne $notifyCommand) { throw 'The notification autostart name is already used; nothing changed.' }
New-ItemProperty -LiteralPath $notifyRunKey -Name $notifyRunName -Value $notifyCommand -PropertyType String -Force | Out-Null
Write-Output 'Enabled the notification server at this Windows user logon.'
