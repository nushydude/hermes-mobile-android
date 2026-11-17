# Hermes protocol client

The package uses the seven vendored Hermes shared TypeScript modules under `src/vendor`, with
`LICENSE.hermes`. `tools/sync-contract.mjs` copies those modules and the MIT license verbatim
from `%LOCALAPPDATA%/hermes/hermes-agent` (or `HERMES_SOURCE`) and writes SHA-256 provenance.
`node tools/sync-contract.mjs --check` checks for drift; normal sync never overwrites the locally
authored `session-http-mutations.ts` adapter or the client layer. Run typecheck and tests after sync.

React Native must install UTF-8 `TextDecoder`, `URL`, and cryptographically secure
`crypto.getRandomValues` before importing this package. The app entry point imports
`fast-text-encoding`, `react-native-url-polyfill/auto` and `react-native-get-random-values` before
loading the protocol. The package's initializer adds a minimal `DOMException` only if absent and
fails closed when the other globals are missing. Metro must resolve the upstream `.js` imports to
their `.ts` source counterparts. Node supports these globals natively.

`CanonicalClient` accepts an HTTPS origin and async credential loader. It mints a fresh WebSocket
ticket per connection, enforces `gateway.ready.session_authority`, advertises client capabilities,
and exposes events and snapshots through injected callbacks. Nothing logs a bearer or ticket.
`requestSecret` receives an AbortSignal for the `sudo` / `secret` secure UI; `request.cancel` and
connection loss abort it. Unsupported desktop bridges receive 4404 and unknown methods -32601.

The app supplies durable `persistSubmission` and `acknowledgeSubmission` callbacks: persistence
completes before the first submit, and the same `submission_id` is reused after an ambiguous lost
reply. A failed submission remains in the caller's outbox for later recovery. `close()` intentionally
does not delete outbox data. Event cursors are per subscribed session. Reconnect replays before
resuming; a replay gap, truncated ring or changed epoch triggers an authoritative snapshot rebuild.
The caller should merge a `resume` snapshot with still-running streamed content; a `rebuild`
snapshot replaces stale local state. Streamed delta offsets are UTF-16 units.
If reconnect replay or resume receives the gateway's structured `4001` or `4004` / `not_found` refusal,
the client removes that session and calls `onSessionUnavailable` once with its ID and sanitized
reason and code. The caller should remove its associated recent-session state. Other failures still
fail the connection attempt and follow the normal reconnect policy.
If a rebuild snapshot says the turn is still running but the replay prefix is unavailable, the
gateway may next emit a delta with a nonzero offset. `onPartialUnavailable` identifies the turn,
segment and offset before that delta is delivered. Present the text as incomplete rather than
claiming an intact reply; `message.complete` supplies the authoritative final text. Do not
re-trigger a snapshot rebuild solely because that first available offset is nonzero.

Detaching while resume/replay is in flight cancels the local mount. If the authority subsequently
returns a subscription, the client detaches that exact returned subscription on its original
connection and never publishes the cancelled snapshot. A timed-out, ambiguous resume closes the
socket to ensure its subscription is not left behind. New opens wait for pending detaches: an
unresolved stored session can map to a different owner, so the short wait applies across aliases.
Each new acquisition owns its own release, even if the gateway reuses a subscription ID.

Create and open a session explicitly before submitting; pass a caller-generated submission ID when
replaying an existing outbox item. `mutate` retries a revision/generation conflict once with the
authority's new fences while preserving the prepared request ID. Methods requiring a generation
fence get one automatically; use `includeGeneration` to override that default. The `rpc` method
uses the generated canonical request/result types, while `request` is the dynamic escape hatch
for methods outside that contract. Send the exact RPC keys documented in `PROTOCOL_CONTRACT.md`;
do not unconditionally retry a rejected steer.

From the repository root: `npm run typecheck --workspace @hermes-mobile/protocol` and
`npm run test --workspace @hermes-mobile/protocol`. The scripted fake server tests never connect to
the real gateway.
