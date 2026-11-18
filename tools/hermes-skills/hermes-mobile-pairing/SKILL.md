---
name: hermes-mobile-pairing
description: Show the private Hermes Mobile pairing QR in a local Windows desktop window when the owner asks to pair or reconnect their phone, and troubleshoot Tailscale connectivity.
---

# Hermes Mobile pairing

Use for the owner's request in Hermes Desktop to pair Hermes Mobile, show its setup QR, or reconnect the phone. This is a local desktop operation, not a Home Dashboard automation or a way to send credentials to another person.

First ask the owner to **open Tailscale on the phone and confirm it is connected**. It may need opening again after a phone restart. Keep Tailscale connected on the PC and the PC awake. If pairing already worked, check this before replacing credentials: blank fields in the setup form do not prove stored settings were erased.

When the owner asks for the QR, use the existing Windows terminal tool to run:

```powershell
$pairingRepo = Join-Path $env:USERPROFILE 'Projects\hermes-mobile'
& (Join-Path $pairingRepo 'tools\show-setup-qr.ps1')
```

The launcher uses an explicit `HERMES_MOBILE_GATEWAY_URL` when set, otherwise the existing Hermes `webapp.public_url`. It reads the existing deployment token privately and opens an owner-visible window. Tell the owner to choose **Scan setup QR code** in Hermes Mobile. The window clears on Enter or after two minutes; rerun the launcher if it expires.

The QR contains a credential. Do not run `show-setup-qr.mjs` directly in a captured terminal, screenshot the QR, paste it or the token into chat, or save/send its payload. Report only launcher success or its sanitized error. This action does not rotate credentials, restart Hermes, change profiles/MCP/Tailscale, clear app data or start inference.

If the launcher reports missing configuration, use `tools\show-setup-qr.ps1 -CheckOnly` for a check without a QR. Verify the repository location and HTTPS endpoint with the owner if needed. Stop on failure; do not dump `.env` or `config.yaml`, invent an endpoint, or alter the Home Dashboard profiles to fix pairing.
