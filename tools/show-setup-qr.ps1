param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path $PSScriptRoot -Parent
$priorOrigin = $env:HERMES_MOBILE_GATEWAY_URL
try {
    if (-not $env:HERMES_MOBILE_GATEWAY_URL) {
        $pairingHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
        $pairingPython = Join-Path $pairingHome 'hermes-agent/venv/Scripts/python.exe'
        if (-not (Test-Path -LiteralPath $pairingPython)) { throw 'Set HERMES_MOBILE_GATEWAY_URL to your HTTPS gateway origin before pairing.' }
        # Select only the configured public URL. Never print configuration or credentials.
        $resolvedOrigin = & $pairingPython (Join-Path $PSScriptRoot 'setup-origin.py') $pairingHome 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $resolvedOrigin) { throw 'Set HERMES_MOBILE_GATEWAY_URL to your HTTPS gateway origin before pairing.' }
        $env:HERMES_MOBILE_GATEWAY_URL = $resolvedOrigin
    }
    Push-Location $workspaceRoot
    try {
        & node --input-type=module -e "import {gatewayOrigin,readDeploymentToken} from './tools/config.mjs'; try { gatewayOrigin(); readDeploymentToken(); } catch { console.error('Pairing configuration unavailable. Check the gateway HTTPS origin and local deployment token.'); process.exit(1); }"
        if ($LASTEXITCODE -ne 0) { throw 'Pairing configuration check failed.' }
    } finally { Pop-Location }
    if ($CheckOnly) { Write-Output 'Pairing configuration is valid; no QR displayed.'; return }
    # This window is intentionally visible: the owner scans the private QR locally.
    # Never redirect its output into Codex, a transcript, a screenshot, or a log.
    Start-Process -FilePath 'powershell.exe' -WorkingDirectory $workspaceRoot -WindowStyle Normal -ArgumentList @('-NoProfile', '-Command', '$Host.UI.RawUI.WindowTitle = ''Hermes Mobile Setup QR''; node .\tools\show-setup-qr.mjs') | Out-Null
    Write-Output 'Opened the private pairing window. Open Tailscale on the phone and confirm it is connected, then scan the setup QR in Hermes Mobile.'
} finally {
    $env:HERMES_MOBILE_GATEWAY_URL = $priorOrigin
}
