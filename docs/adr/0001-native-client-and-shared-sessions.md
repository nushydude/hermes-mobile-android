# ADR 0001: Native Android client with shared sessions

- **Status:** Accepted
- **Decision date:** 15 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The owner needs a session list and conversations on a Pixel, with the same Hermes sessions available
on the desktop. The app is for one person, uses the PC's `default` profile and is sideloaded.
The existing Telegram experience has a single-session interface for this purpose.

## Decision

Build a React Native/Expo Android app with its own native UI. Connect to the gateway's canonical
session authority so a phone-created or desktop-created session can be continued from the other
client. Create phone sessions with `source: "gui"`, subject to the gateway's advertised capabilities.
Use the gateway's Webapp **listener** as the API endpoint; do not display its web UI.

## Alternatives

A WebView wrapping the Hermes web app was explicitly rejected by the owner. The community
`hermes-mobile` messaging adapter creates its own messaging-channel experience and does not supply
the shared Desktop sessions required here. The legacy dashboard/serve surface does not expose the
same canonical session authority.

## Consequences

The app owns its navigation and interaction design, and must handle gateway capabilities, subscriptions,
history and desktop-only requests. Expo Go is insufficient for the native modules used here.
Multi-profile management and Desktop management surfaces were outside the initial scope. The owner
later authorized voice; [ADR 0006](0006-continuity-first-voice.md) records that addition.

## Evidence

[PLAN.md](../../PLAN.md) records the decision and owner constraints. The real gateway smoke and
bidirectional Desktop handoff are documented in [PROTOCOL_CONTRACT.md](../../PROTOCOL_CONTRACT.md).
The complete phone acceptance checklist remains open; a desktop smoke alone is not phone acceptance.
