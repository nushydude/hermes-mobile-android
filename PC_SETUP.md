# PC setup and operations

This guide describes the intended Windows and Android setup. Replace example addresses with your own values. Historical setup observations are in the [journal](docs/history/PC_SETUP_HISTORY.md); they do not establish your configuration or current service health.

## Gateway and network

A compatible Hermes gateway must expose its authenticated Webapp listener over HTTPS/WSS, for example through Tailscale Serve. `https://desktop.example-tailnet.ts.net:9120` is a placeholder. Configure the gateway's public URL to match your actual endpoint, keep its backend listener on loopback, and use a strong dashboard session token. Verify authentication and session authority against your gateway version. The [plan](PLAN.md) and [protocol observations](PROTOCOL_CONTRACT.md) give the original deployment context.

Back up configuration before changes; preserve existing Serve mappings and services. Restarting the gateway interrupts active work, so arrange an appropriate maintenance window. Keep the PC awake and Tailscale connected on both devices. Do not enable public Funnel merely for this app.

## Provision the phone

**First open Tailscale on the phone and confirm it is connected.** Check this again after a phone restart. Keep the PC awake and connected to Tailscale too. Hermes Mobile cannot reach the tailnet gateway while the phone's Tailscale connection is off.

On this Windows installation, `npm run setup:qr` can read the existing Hermes `webapp.public_url` using its installed Python environment. It opens a private desktop window, with no credential in the command output. `pwsh -NoProfile -File tools/show-setup-qr.ps1 -CheckOnly` checks configuration without displaying a QR. An explicitly supplied HTTPS origin takes precedence; for another installation set it in PowerShell:

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

If connection fails, first open **Tailscale on the phone** and confirm **Connected**. Then check Tailscale on the PC, that the PC is awake, and the gateway/HTTPS endpoint. Do this before re-pairing or clearing anything. The setup form starts blank even when credentials are stored, so blank fields do not establish settings loss. A persistent connection error is shown after the startup grace period. Preserve uncertain outbox entries rather than submitting a duplicate. Voice waits for a completed reply; a waiting timer does not predict model completion time.

## Ask Hermes Desktop for pairing

The local `hermes-mobile-pairing` skill lets the owner ask **“Show my Hermes Mobile pairing QR.”** Its source is [SKILL.md](tools/hermes-skills/hermes-mobile-pairing/SKILL.md); the installed copy belongs in the default Hermes home's `skills/hermes-mobile-pairing/` directory. A new desktop conversation can discover it without changing gateway/profile settings or restarting the gateway. The QR appears only in a local window and clears after two minutes. It is never a chat attachment.
