# ADR 0003: Tailnet TLS and session-token provisioning

- **Status:** Accepted
- **Decision date:** 15 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The gateway runs on the owner's Windows PC and is accessed from the phone over Tailscale. The
deployment session token has operator-level access. Existing Serve mappings and messaging profiles
belong to other workflows and must be preserved.

## Decision

Use HTTPS/WSS through the dedicated Tailscale Serve endpoint and the gateway's own loopback listener.
Authenticate REST requests with the deployment session token and mint a fresh short-lived WebSocket
ticket for each canonical connection. Provision the token to the phone through a locally displayed
QR and store the credential pair with Expo SecureStore. Android cleartext traffic is disabled.
Never print, log or commit the token, read `auth.json`, or enable Tailscale Funnel.

## Alternatives

The older specification's cleartext configuration and ticket bridge were rejected. Re-exporting
local attach tickets through a bridge would change the authentication boundary. Firebase or another
new external account is not required by this transport decision.

## Consequences

The phone needs Tailscale and the PC/gateway must be available. With only the token provider, the
browser dashboard has no interactive sign-in; the native app uses the authenticated API instead.
Ask the owner before any future gateway restart, back up `config.yaml` before changing it, and do
not modify existing Serve mappings, Hermes source, other profiles or messaging configuration.

## Evidence

[PC_SETUP.md](../../PC_SETUP.md) documents setup, token handling and rollback. The bearer-authenticated
ticket and canonical WSS connection were tested through Tailscale as recorded in
[PROTOCOL_CONTRACT.md](../../PROTOCOL_CONTRACT.md). Alternative ticket fallbacks were not tested.
