# PC setup and operations

This guide describes the intended Windows and Android setup. Replace example addresses with your own values. Historical setup observations are in the [journal](docs/history/PC_SETUP_HISTORY.md); they do not establish your configuration or current service health.

## Gateway and network

A compatible Hermes gateway must expose its authenticated Webapp listener over HTTPS/WSS, for example through Tailscale Serve. `https://desktop.example-tailnet.ts.net:9120` is a placeholder. Configure the gateway's public URL to match your actual endpoint, keep its backend listener on loopback, and use a strong dashboard session token. Verify authentication and session authority against your gateway version. The [plan](PLAN.md) and [protocol observations](PROTOCOL_CONTRACT.md) give the original deployment context.

Back up configuration before changes; preserve existing Serve mappings and services. Restarting the gateway interrupts active work, so arrange an appropriate maintenance window. Keep the PC awake and Tailscale connected on both devices. Do not enable public Funnel merely for this app.

## Provision the phone

In PowerShell, set your actual HTTPS origin before using the tools:

```powershell
$env:HERMES_MOBILE_GATEWAY_URL = 'https://desktop.example-tailnet.ts.net:9120' # replace this
# Optional when your Hermes home is elsewhere:
$env:HERMES_HOME = 'C:\path\to\hermes-home'
npm run setup:qr
```

The setup tools use the dashboard session token from the configured Hermes home. Display the private QR only to the intended phone; do not capture, redirect, log or commit it. On the phone choose **Scan setup QR code**. The credential is stored in Android SecureStore; ordinary SQLite history, drafts and outbox are not app-level encrypted. See the tool help/source before provisioning or verifying a gateway.

## Rotate and maintain

Replace the dashboard token with a fresh cryptographically random value in the gateway's private environment without printing it, then restart in an agreed maintenance window. Verify the new token and rejection of the old one, and reprovision the phone. Preserve other environment entries and do not commit token-bearing backups. Configuration, startup method and rollback depend on your own deployment; record and restore only settings you changed.

Build and install guidance is in [development](docs/development.md), including the debug signing limitation. An APK built with a different signing key cannot update an existing installation in place. Avoid clearing app data to force an update: drafts and provisioning can be lost. For notifications, including optional ntfy configuration and limits, see [NOTIFICATIONS.md](NOTIFICATIONS.md).

If connection fails, check the PC, gateway, HTTPS endpoint and tailnet first. A persistent connection error is shown after the startup grace period. Preserve uncertain outbox entries rather than submitting a duplicate. Voice waits for a completed reply; a waiting timer does not predict model completion time.
