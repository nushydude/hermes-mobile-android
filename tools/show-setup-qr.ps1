$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path $PSScriptRoot -Parent
# This window is intentionally visible: the owner scans the private QR locally.
# Never redirect its output into Codex, a transcript, a screenshot, or a log.
Start-Process -FilePath 'powershell.exe' -WorkingDirectory $workspaceRoot -WindowStyle Normal -ArgumentList @('-NoProfile', '-Command', '$Host.UI.RawUI.WindowTitle = ''Hermes Mobile Setup QR''; node .\tools\show-setup-qr.mjs') | Out-Null
