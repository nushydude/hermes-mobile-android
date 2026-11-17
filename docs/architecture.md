# Architecture

Recorded 17 November 2026. Accepted decisions are indexed in [ADRs](adr/README.md);
wire observations are in [PROTOCOL_CONTRACT](../PROTOCOL_CONTRACT.md).

## System boundary

Hermes Mobile is a native Expo/React Native app, not a WebView or a messaging adapter.
For example, it connects over Tailscale HTTPS/WSS to `desktop.example-tailnet.ts.net:9120`
(a placeholder; configure your own host). Tailscale Serve proxies
to the gateway's loopback listener at `127.0.0.1:9120`. The gateway is the session authority for
the single default profile, shared with Desktop. Browser sign-in is not the phone setup flow.

The separate PC notification hook publishes generic alerts to loopback ntfy on 9130, exposed to
the tailnet through HTTPS 9121. The ntfy Android client receives that path independently of Hermes
Mobile. Preserve any unrelated Serve mappings and avoid public Funnel.

## Components

| Component | Responsibility | Source |
| --- | --- | --- |
| App/screens | Setup, session navigation, required secure input and native UI | [App](../app/App.tsx), [screens](../app/src/screens/ChatScreen.tsx) |
| AppManager singleton | Credentials, origin-scoped cache, drafts/outbox, session lifecycle and UI subscriptions | [state](../app/src/state/index.ts) |
| CanonicalClient | Ticket dial, authority/capability checks, RPC correlation, revisions/generations, replay and aliases | [client](../packages/hermes-protocol/src/client.ts) |
| Vendored contract | Hermes generated types/shared transport with provenance | [vendor](../packages/hermes-protocol/src/vendor/provenance.json) |
| Voice controller/correlation | Foreground capture state, durable submission identity and exact reply ownership | [controller](../app/src/components/voiceController.ts), [correlation](../app/src/components/voiceCorrelation.ts) |
| Playback owner | Bounded TTS sections, one-next-section prefetch and cancellation-safe resources | [playback](../app/src/components/voicePlayback.ts) |
| Notifications | Local display/dedup, safe action routing and optional foreground monitor | [adapter](../app/src/notifications.ts) |
| Native share inbox | Cold/warm Android intents, private copies, type/size checks and bounded provider I/O | [module](../app/modules/hermes-sharing/android/src/main/java/net/taild39a23/hermesmobile/sharing/HermesSharingModule.kt) |
| Share chooser | Explicit recipient, review, image preparation and durable draft import | [chooser](../app/src/sharing/IncomingShareSheet.tsx) |
| PC notification plugin | Non-blocking, bounded best-effort generic ntfy publication | [hook](../tools/notifications/plugin/phone-notify/__init__.py) |

UI subscriptions use the module-level manager; changing screens does not deliberately disconnect
the canonical transport. Recently opened sessions remain subscribed, with idle-cache limits and
protection for running work, requests and recovery data.

## Authentication and transport

The origin/token are one versioned SecureStore credential pair. Each transport uses immutable
credentials; setup stages a candidate before switching. REST uses bearer auth. Each dial mints a
fresh short-lived, single-use WebSocket ticket and offers the canonical subprotocol. The client
requires `gateway.ready.session_authority` and uses runtime-described capabilities/create parameters.

TLS validation remains enabled. The deployment token is never a log field, bundled constant or
committed artifact. Provisioning is a private, expiring local QR. Unsupported Desktop bridge
requests receive 4404; unknown methods receive -32601. Required sudo/secret input has explicit
secure UI and cancellation. These rules are unrelated to new external account sign-in.

## Durable text delivery and recovery

1. Write the prompt, immutable submission ID and order to the local outbox before transmission.
2. Resume the canonical session before submit. A receipt means accepted/queued/started, not finished.
3. Retry ambiguous delivery with the same ID. Do not infer identity from matching message text.
4. Reconcile authoritative rows/receipts; retain unmatched saved text conservatively.
5. Reconnect with per-session sequence/epoch replay, then resume. Rebuild after a gap or changed epoch.
6. Fence stale async work by endpoint, session, revision/generation and resource ownership.

Queued and unknown admissions have different controls. A started admission is not shown as queued.
Alias resolution preserves drafts, queued ordering, imported-share identity and image drafts without
stealing newer navigation. Images removed by a failed send are restored alongside newer edits.

## Storage

- SecureStore: versioned gateway origin/token credential pair.
- Origin-scoped SQLite: session cache, text/image drafts, outbox, local saved text and recovery state.
- Preferences SQLite: local activity visibility, monitor mode and model favourites.
- Notification SQLite: bounded replay/display deduplication ledger.
- Native `noBackupFilesDir`: pending incoming shares and owned copies, excluded from automatic backup.
- Cache: temporary capture/playback files and image previews; Android may evict these.

SQLite is not encrypted by application code. Only credentials use SecureStore; do not describe
the whole history/cache as Keystore-encrypted. Origin scoping isolates work, not multiple Hermes profiles.

## Voice

Voice is foreground, half-duplex and continuity-first: capture -> gateway complete-file STT ->
review or hands-free endpoint -> ordinary durable text submission -> exactly matched final reply ->
gateway TTS -> playback -> optional next capture. It does not use auxiliary `voice_turn` routing,
change selected settings, create a replacement session, or treat spoken assent as approval.

One native meter stream drives the timer and detector. Initial room calibration, sustained speech
and quiet duration determine the hands-free endpoint. Missing/stale readings, requests and connection
gaps pause it. Playback/capture do not intentionally overlap. Only natural completion of the current
automatic reply rearms listening. Provisional deltas may precede more tool work, so they are not spoken.

## Android sharing

Intents create reviewable inbox items; they do not execute commands or submit prompts. Image source
types/signatures and byte limits are checked. Provider work has a 15-second whole-share deadline
and two bounded daemon workers. Timed-out workers cannot commit and clean late staging files.
Two non-returning providers can occupy those workers until recovery/restart; other inbox/text work remains usable.

The chooser retains the selected canonical destination, checks navigation/endpoint identity and
lets the owner edit text. It creates independent preview copies, uploads supported images, and
checkpoints the combined draft before discarding the native source. Retry uses the import identity
to avoid appending twice. No automatic send. A freshly redelivered OS intent can still produce
another reviewable item; identical intentional shares are not collapsed by content.

## Notification delivery

The local tier needs a live process/socket and subscribed sessions. Visible-chat alerts are
suppressed. Notification actions revalidate origin, request, generation and offered safe choices.
The optional remoteMessaging service helps connectivity but is not a delivery guarantee.

The PC/ntfy tier is independent and best-effort. It uses generic messages/session links, not reply
previews, and has filtering/deduplication/worker limitations. The two tiers may overlap. See
[notification operations](../NOTIFICATIONS.md) and [acceptance](verification.md).
