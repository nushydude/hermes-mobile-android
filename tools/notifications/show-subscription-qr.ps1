$ErrorActionPreference = 'Stop'
$notifyRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# This is an intentionally visible private QR window for the owner.
Start-Process -FilePath powershell.exe -WorkingDirectory $notifyRoot -WindowStyle Normal -ArgumentList @('-NoProfile','-Command','$Host.UI.RawUI.WindowTitle = ''Hermes Notifications Subscription QR''; node .\tools\notifications\show-subscription-qr.mjs') | Out-Null
