# Security

## Reporting a vulnerability

Please do not post credentials, setup QR codes, transcripts or exploit details in
a public issue. Use GitHub's **Report a vulnerability** option in this repository's
Security tab if available. If private reporting is unavailable, open a minimal issue
asking the maintainer for a private reporting channel, without sensitive details.

Include the affected app/gateway versions, reproduction steps and impact. There
is no response-time guarantee; this is a community project. Only the current
development line receives fixes.

## Trust boundaries

- Use your own HTTPS gateway reachable over a private network such as Tailscale.
  The app deliberately rejects cleartext transport. Do not expose it with Funnel
  as part of this setup.
- A setup QR contains a gateway bearer credential. Display it only locally, clear
  it after scanning and rotate the token if it leaks. Never attach it to an issue.
- The origin and token are stored in Android SecureStore. Cached chat history,
  drafts, attachments and the outbox are private app data but do not have separate
  app-level database encryption. Secure the device and its backups accordingly.
- Notification previews can contain response text; visibility also depends on
  Android's notification and lock-screen settings.
- Voice recordings/transcripts and speech generation use your configured Hermes
  gateway and its speech providers. Their privacy and retention settings apply.
- The optional PC notification service adds another credentialed delivery path.
  Review [NOTIFICATIONS.md](NOTIFICATIONS.md) before enabling it.
- Development preview builds currently use debug signing. A dedicated production
  signing and distribution process has not been established.

## Before publishing changes

Check both staged files and any existing Git history. Ignore rules do not remove
previously committed secrets. Keep `.env`, `auth.json`, local config, keys, QR codes,
build artifacts and chat exports out of Git. Never paste raw HTTP/WebSocket frames
or configuration into a report without reviewing and redacting them first.
