$ErrorActionPreference = 'Stop'
$notifyRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$notifyExe = Join-Path $notifyRoot '.toolchain/ntfy/ntfy_2.38.0_windows_amd64/ntfy.exe'
$notifyRuntime = Join-Path $notifyRoot '.artifacts/notifications'
if (-not (Test-Path -LiteralPath (Join-Path $notifyRuntime 'server.yml'))) { throw 'Prepare the private notification runtime first.' }
if (Get-NetTCPConnection -State Listen -LocalPort 9130 -ErrorAction SilentlyContinue) { throw 'Port 9130 is already occupied; no process was changed.' }
$notifyProcess = Start-Process -FilePath $notifyExe -ArgumentList @('serve','--config',('"'+(Join-Path $notifyRuntime 'server.yml')+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $notifyRuntime 'server-stdout.log') -RedirectStandardError (Join-Path $notifyRuntime 'server-stderr.log')
$notifyProcess.Id | Set-Content -LiteralPath (Join-Path $notifyRuntime 'server.pid')
Write-Output 'Started the private loopback notification server.'
