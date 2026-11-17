# Hermes Mobile: execution plan

> This remains the governing scope/constraints document. Section 2 is the original 15 November baseline; later owner-authorized follow-ups supersede earlier exclusions and checkpoints. For the current installed build and acceptance gaps, see [status](docs/STATUS.md), [setup](PC_SETUP.md), and [ADRs](docs/adr/README.md).

Supersedes `spec.md` (the Gemini draft). Read this whole file before doing anything.

## 1. What is being built

A purpose-built native Android chat app for one person, sideloaded onto a Pixel 11 Pro XL, that talks
to the Hermes gateway on this Windows PC over Tailscale. The owner uses Telegram with Hermes today and
wants what Telegram cannot give:

- many sessions, visible at once, switchable instantly
- the **same** sessions as the desktop app: start on desktop and continue on the phone, and back
- a real phone chat experience: streaming, tool and thinking cards, approvals, notifications

It is not a consumer product: no Play Store, no iOS, no accounts, no multi-user concerns.

**Decided, do not reopen:** the owner does not want the Hermes Webapp UI wrapped in a WebView. The app
has its own native UI. (The gateway's *Webapp listener* is still used as the network endpoint, see
section 3; none of its web UI is shown.)

### In scope for v1

Session list (live and history), multi-session chat with streaming, reasoning and tool cards,
approvals and clarify, queue/steer/stop, slash commands, model and reasoning switching, image
attachments, rename/pin/archive/delete, reconnect with catch-up, notifications.

### Not in v1

The desktop app's management surfaces: settings panes, file tree, Git review, terminal, cron, skills,
memory graph, bots/group chats, artifacts gallery, voice mode, multiple profiles (the gateway here
serves only the `default` profile). Design the navigation so these can be added later, but do not
build them.

## 2. Historical baseline (2026-11-15)

These observations describe the original installation only; hostnames and addresses are placeholders. Do not assume they describe your system.

- Hermes `v0.23.1+4451.gea1d785`, git install. Home: `%LOCALAPPDATA%\hermes`. Source checkout:
  `%LOCALAPPDATA%\hermes\hermes-agent` (paths in this plan are relative to it). MIT licensed.
- Gateway runs as scheduled task `Hermes_Gateway`. It is **standalone** (serves only `default`).
  Do not run `hermes gateway migrate`.
- `webapp.enabled` is off, nothing listens on 9119/9120, no sign-in provider is configured.
- Tailscale: PC is `desktop.example-tailnet.ts.net` (`100.x.y.z`). Serve already uses HTTPS ports
  **443, 8443, 8444** for other things; leave them alone. The phone `android-device` shows offline,
  last seen 17 days ago: Tailscale must be turned on there.
- Tooling: Node v24.22.2, npm 11. **No JDK, Android SDK, adb or pnpm.**

## 3. Architecture

```
Pixel app (React Native, native UI)
   │  HTTPS + WSS   https://desktop.example-tailnet.ts.net:9120      (tailnet only, real TLS)
   ▼
Tailscale Serve  ──►  http://127.0.0.1:9120   gateway's own listener, sign-in gated
                              │   /api/ws  canonical protocol "hermes-gateway-v1"
                              ▼
                   the one Hermes gateway (same sessions as Desktop/CLI/TUI)
```

Three decisions, each backed by the source:

1. **Endpoint: the gateway's own listener, exposed by `webapp.enabled: true`.** Only that listener has
   the session authority, so only there does `/api/ws` speak the canonical protocol with shared,
   multi-viewer sessions (`gateway/run_api.py:97`, `tui_gateway/ws.py:377-410, 656-662`). `hermes serve`
   and `hermes dashboard` (9119) give a legacy surface without it: do not use them. The app must check
   `gateway.ready.payload.session_authority === true` and refuse to continue otherwise.
2. **Auth: the deployment session token.** Set `HERMES_DASHBOARD_SESSION_TOKEN`; the bundled
   `session-token` provider then accepts it as `Authorization: Bearer` on REST and lets the app mint
   30-second single-use WebSocket tickets (`plugins/dashboard_auth/session_token/__init__.py`,
   `hermes_cli/dashboard_auth/middleware.py:265-325`, `hermes_cli/web_server_chat.py:204-419`). One
   long random secret, stored in the Android Keystore. A token-authenticated socket gets full operator
   scopes including `session:create` and `session:operator` (`gateway/session_controls.py:143-155`),
   which is what allows attaching to sessions the desktop app created.
3. **Stack: React Native (Expo development build) + TypeScript.** Hermes's protocol is defined in
   TypeScript (`apps/shared/src/gateway-contract.generated.ts`, 281 KB of generated types) with a
   transport-agnostic client (`json-rpc-channel.ts`, `json-rpc-gateway.ts`). Vendoring those is far
   safer than hand-porting the contract to Kotlin. Expo Go is not sufficient (native modules needed).

Do **not** carry over from `spec.md`:

- the "ticket bridge" around `hermes gateway attach`. Those tickets are for same-user local clients;
  re-exporting them over HTTP is an authentication bypass.
- `usesCleartextTraffic` / `ws://`. Everything is HTTPS through Tailscale Serve.
- `source: "mobile"`. `session.create` accepts only `cli|tui|gui|acp|tool|oneshot`.
- treating approvals as server-to-client requests. On the canonical protocol they are events plus a
  respond RPC (section 5).

Also considered and rejected: the community `hermes-mobile` adapter in `plugin-catalog/`. It is a
messaging platform like Telegram (its own channel per device) and does not share desktop sessions.

## 4. Rules for the implementing agent

1. **Ask before restarting the gateway.** It interrupts Telegram and running chats and refuses to
   restart mid-turn.
2. **Back up `config.yaml` first**: `config.yaml.pre-mobile-<yyyyMMddHHmmss>.bak` (existing convention).
3. **Never print, log or commit the session token.** Generate it straight into `.env`; hand it to the
   phone by QR code shown once in the terminal. Do not read `auth.json` or dump `.env`.
4. **Do not modify the Hermes checkout.** `hermes update` overwrites it. Copy what you need out of it.
5. Do not touch existing Tailscale Serve mappings, messaging config or profiles. Never use Funnel.
6. All work goes under `<repository>\`. `git init` first. Keep secrets and
   the signing keystore out of the repo.
7. Section 5 is research from reading source, not from a running system. Milestone 2 exists to verify
   it; when reality differs, the running gateway wins and `PROTOCOL_CONTRACT.md` records the truth.
8. Stop at each gate and report to the owner.

## 5. Protocol reference (from source; verify in Milestone 2)

### Connect

1. `POST {base}/api/auth/ws-ticket` with `Authorization: Bearer <token>` returns
   `{ticket, ttl_seconds: 30}`. One ticket per dial.
2. Open `wss://{host}/api/ws` offering subprotocols `hermes-gateway-v1` and
   `hermes-gateway-ticket.<ticket>`. The server selects `hermes-gateway-v1`. Fallback if tickets
   misbehave: `?token=<urlencoded token>` with no subprotocol.
3. Never send the header `X-Hermes-Gateway-Ticket` (it forces a refusal). An absent `Origin` is
   accepted; if the WebSocket library sets one it must be `https://<public_url host>`.
4. Auth failures close before accept and surface as an HTTP 403 handshake failure, not a readable
   close code. To diagnose, call `GET /api/auth/me` with the bearer (401 = bad token).
5. Frames are JSON-RPC 2.0, one object per text frame. First server frame is the event
   `gateway.ready` with `{session_authority, heartbeat, replay_epoch, ...}`.
6. Then send `client.capabilities {"server_requests": true}` (do not send `desktop_local`) and
   `runtime.describe {}` (params must be empty). Check `session_create.parameters` before sending any
   optional create key, and remember the capability list for feature checks.
7. Keepalive: send `gateway.ping {}` every 15 s; treat 45 s without any inbound frame as dead.

### Sessions

| Need | Call |
|---|---|
| Live list | `session.list {scope:"live", limit, picker:true}` |
| History list | `session.list {scope:"stored", limit, picker:true}` |
| Create | `session.create {request_id, source, client:{name:"hermes-mobile", version}, cwd?, model?, title?}` |
| Attach + backlog + live events | `session.resume {session_id, display_projection:true}` |
| Older messages | `session.transcript {session_id, order:"latest", cursor?, limit, inline_images?}` |
| Rename, pin, archive, delete | `session.mutate {session_id, request_id, expected_revision, operation, payload, expected_generation?}` |
| Leave | `session.detach {session_id, subscription_id}` (no `end_reason`, or the session may be closed) |

- The dispatcher rejects unknown keys with `4001 invalid_params`: send exactly the documented keys.
- `session.resume` returns a snapshot: messages, `running`, `revision`, `execution_generation`,
  `subscription_id`, `last_sequence`, `replay_epoch`, `pending` (queued prompts), `prompts` (open
  approvals/clarifies), `open_requests`, `info` (model, title, cwd...). It also subscribes the socket;
  `prompt.submit` and `approval.respond` are refused until the session has been resumed on this socket.
- One socket can be subscribed to many sessions. Every event carries `session_id`, `seq`,
  `replay_epoch`, `authority_epoch`, `execution_generation`, `admission_id`.
- `session.mutate` operations: `rename {title}`, `archive {archived}`, `sidebar {pinned?, hidden?, ...}`,
  `delete {}`, `model {model, provider?, reasoning?, confirm?}`, `reasoning {effort|null}`. On
  `revision_conflict` / `stale_generation` the error data carries fresh values: retry once with them.
- **`source` for phone-created sessions: use `"gui"`** so they are first-class desktop sessions for
  handoff (toolsets are frozen at creation). The cost is that the agent may call desktop-only UI
  bridges; decline those as described below. Revisit in Milestone 2 if this is noisy (`"tui"` avoids
  them).

### Sending

- `prompt.submit {session_id, submission_id: <uuid>, text, attachments?: [{path, mime}]}` returns an
  admission receipt (`admission_id`, `status: queued|started|...`). The receipt means durably accepted,
  not finished. It is idempotent on `submission_id`: persist the id before sending and retry with the
  same id after a lost reply. Do not send `clarify_batch` in v1.
- A submit during a running turn queues. Queue control: `prompt.cancel`, `prompt.replace_queued`,
  `prompt.steer_queued`. A turn lost across a gateway restart shows `status: unknown` and needs
  `prompt.resolve_unknown`.
- Stop: `session.interrupt {session_id, execution_generation}`.
- Steer: `session.steer {session_id, execution_generation, text}`; on `status: rejected` fall back to
  a normal submit.
- Slash commands: `commands.catalog`, `complete.slash {text, session_id}`,
  `command.dispatch {name, arg, session_id}` (result `type` is `exec|alias|plugin|send|skill|prefill`),
  `slash.exec`. Route `/model`, `/compress`, `/branch` through `session.mutate` as the desktop does
  (`apps/desktop/src/api/canonical-protocol.ts:63-85`).
- Models: `model.options {session_id}`; switch with `session.mutate operation:"model"`. Handle result
  `status: "deferred"` (applies next turn) and `"confirmation_required"` (resend with the `confirm`
  token after asking the user).

### Events a chat screen must handle

`message.start`, `message.delta {text|null, segment, offset}` (null text = segment boundary; use
segment/offset to drop duplicates), `message.interim`, `message.complete {text, status, usage,
persisted_turn}`, `reasoning.delta`, `thinking.delta`, `tool.generating`, `tool.start`,
`tool.progress`, `tool.complete`, `todo.updated`, `status.update` (includes compaction),
`session.usage`, `session.info` (running, pending queue, revision, generation), `session.updated`,
`sessions.changed` (refetch the list), `session.replay_gap`, `error`, `notice`, `subagent.*`,
`approval.request|settled|cancelled`, `clarify.request|settled`, `request.cancel`.
Payload shapes: `tui_gateway/contracts/events.py` and the generated TypeScript contract.

A prompt sent from the other device has no dedicated event: it appears in `session.info.pending`, then
as the normal turn stream.

### Approvals, clarify, server requests

- Approval: event `approval.request {prompt_id, execution_generation, command, description, choices}`;
  answer with `approval.respond {session_id, execution_generation, prompt_id, choice}` (exactly these
  keys). Dismiss on `approval.settled` / `approval.cancelled` (answered on another device, expired).
- Clarify: event `clarify.request {prompt_id, question, choices, multi_select}`; answer with
  `clarify.respond {session_id, execution_generation, prompt_id, answer}`.
- Open prompts are returned again in the resume snapshot's `prompts`.
- True server-to-client JSON-RPC requests (frames with both `id` and `method`): `sudo` and `secret`
  (answer `{value}` from a secure input sheet), plus desktop bridges `preview.*`, `terminal.read`,
  `window.read`, `tour`, `theme.*`, `vault.*`, `setup_beat`. Decline bridges with error code **4404**;
  answer any unknown method with **-32601** so the agent never hangs. Withdrawn requests arrive as
  `request.cancel`.

### Reconnect

Keep the last `seq` and `replay_epoch` per session. After reconnecting, for each open session call
`session.events.since {session_id, last_sequence, replay_epoch}` then `session.resume`. If the reply
says `snapshot_required` (or a `session.replay_gap` event arrives), discard local live state and
rebuild from a fresh resume. The replay ring is 512 frames / 4 MiB per session.

### Attachments

`POST /api/chat/image-upload` with `{data_url, filename}` (bearer auth, 25 MiB cap) returns `{path,
mime_type}`; pass `[{path, mime}]` to `prompt.submit`. Accepted mime at submit: png, jpeg, gif, webp,
max 10 per prompt. Convert HEIC to JPEG on the phone. Tool images in history: `GET
/api/fs/read-data-url?path=&session_id=`.

### Open questions Milestone 2 must answer

1. Does `/api/auth/ws-ticket` work with the bearer token on this listener (else
   `/api/webapp/socket-ticket?socket=gateway`, else `?token=`)?
2. Does a token login see **stored** history rows and can it continue old sessions, or is
   `hermes sessions adopt` needed? (Code and docs disagree.)
3. Joining a session mid-turn: can the partial reply so far be recovered (try `session.events.since`
   with a lower sequence), or only deltas from the moment of joining?
4. How do auto-generated titles arrive (`session.updated`, `session.info` or `sessions.changed`)?
5. Does Tailscale Serve pass the WebSocket upgrade and a Host the gateway accepts?
6. Does the scheduled-task gateway pick up the token from `.env`?
7. Do the API routes work when the Webapp bundle has not been built?
8. `source: "gui"` vs `"tui"` for phone-created sessions: how often do desktop bridges fire?

## 6. Milestone 1: PC setup (no app code)

1. Back up `config.yaml`.
2. Generate a 32-byte URL-safe random token directly into `%LOCALAPPDATA%\hermes\.env` as
   `HERMES_DASHBOARD_SESSION_TOKEN=...` without echoing it.
3. ```
   hermes config set webapp.enabled true
   hermes config set webapp.public_url https://desktop.example-tailnet.ts.net:9120
   ```
   Leave `webapp.host` at `127.0.0.1`. A non-loopback `public_url` is what turns the sign-in gate on.
4. With the owner's go-ahead: `hermes gateway restart`, then `hermes webapp --status`.
5. `tailscale serve --bg --https=9120 http://127.0.0.1:9120`, then `tailscale serve status`. If the
   port is refused, choose another free HTTPS port and change `public_url` to match exactly.
6. Verify from the PC: `GET https://desktop.example-tailnet.ts.net:9120/api/status` shows
   `auth_required: true` and `session-token` in `auth_providers`; `GET /api/auth/me` returns 200 with
   the bearer and 401 without. Confirm the desktop app and Telegram still work.
7. Run `hermes sessions adopt` (harmless; makes older chats continuable).
8. Write `PC_SETUP.md`: what changed, how to rotate the token, how to undo everything.

Side effect to tell the owner: with only the token provider, the browser Webapp on this port has no
way to sign in. That is fine here, the web UI is not being used.

**Gate 1:** report results. Ask the owner to turn Tailscale on on the phone (Always-on VPN is best).

## 7. Milestone 2: prove the protocol before writing UI

Build `tools/smoke/` (Node + TypeScript, run on the PC against the **Tailscale URL**, not loopback):

- ticket mint, dial, `gateway.ready`, capabilities, `runtime.describe`
- list live and stored sessions; resume a session the desktop app created
- create a session, submit a prompt, print every event until `message.complete`
- with the desktop app open on the same session: submit from the script and watch it appear on
  desktop; submit on desktop and watch the script receive it
- trigger an approval (ask for a shell command that needs one) and answer it from the script; answer
  one on desktop and observe `approval.settled`
- kill the socket mid-turn, reconnect, catch up with `session.events.since`
- rename and archive with `session.mutate`; upload an image and submit it

Write `PROTOCOL_CONTRACT.md` from what was actually observed: real frames, answers to the eight open
questions, and every place section 5 was wrong. Keep the smoke script; it is the regression test to
rerun after every `hermes update`.

**Gate 2:** report. If shared live sessions between desktop and the script do not work as described,
stop: the core premise needs rethinking with the owner.

## 8. Milestone 3: toolchain, scaffold, protocol package

Toolchain (none present): JDK 17, Android command-line tools with `sdkmanager` (platform-tools, the
platform and build-tools matching the phone's API level from `adb shell getprop ro.build.version.sdk`,
NDK and CMake as React Native requires), `ANDROID_HOME`. Android Studio is not needed.

```
hermes-mobile/
  PLAN.md  PC_SETUP.md  PROTOCOL_CONTRACT.md
  tools/smoke/                 Milestone 2 script
  tools/sync-contract.mjs      copies the vendored files from the local Hermes checkout
  packages/hermes-protocol/    vendored + adapted Hermes client code, no React, fully unit tested
  app/                         Expo app (dev build, Android only)
```

`packages/hermes-protocol`:

- Vendor from `apps/shared/src/` with the MIT notice: `gateway-contract.generated.ts`,
  `gateway-events.ts`, `gateway-canonical.ts`, `gateway-text.ts`, `reconnect-backoff.ts`,
  `json-rpc-channel.ts`, `json-rpc-gateway.ts`. Skip `src/node/*`, `i18n.ts`, `external-url.ts`.
- React Native gaps to handle: `TextDecoder`, `DOMException`, `URL`, and `.js`-suffixed imports in
  Metro.
- Add the canonical session layer the shared package lacks (generation and revision tracking,
  auto-resume, cursors). Port the logic from `apps/desktop/src/api/client.ts` and
  `canonical-protocol.ts` rather than inventing it.
- `sync-contract.mjs` re-copies the generated contract after a Hermes update; a typecheck failure is
  the early warning that the protocol moved.

Unit tests against a scripted fake server: request correlation and timeouts, one fresh ticket per
dial, heartbeat death and backoff, per-session cursor and `events.since` catch-up, `snapshot_required`
and `replay_gap` rebuild, delta de-duplication by segment/offset, idempotent submit retry, revision
conflict retry, stale-generation handling, server-request answers (`sudo`, 4404 for bridges, -32601
for unknown), `request.cancel`.

## 9. Milestone 4: the app

### Foundations

- **Connection manager** as a module-level singleton outside React (Zustand store or similar), so
  navigation never drops a stream. States: offline, connecting, ready, reconnecting, auth-failed,
  incompatible (no `session_authority`). Reconnect immediately on app foreground and on network
  change; exponential backoff otherwise.
- **Setup screen:** base URL and token, entered by scanning the QR from `PC_SETUP`, stored with
  `expo-secure-store`. "Test connection" runs `/api/auth/me` then a dial, and explains failures in
  plain terms (Tailscale off, PC asleep, bad token, gateway restarting).
- **Local cache** (MMKV or SQLite): session list and the latest snapshot per session, so the app opens
  instantly and is readable offline. Server state always wins on reconnect.
- **Outbox:** a prompt is written locally with its `submission_id` before sending and removed on a
  matching receipt, so nothing typed on a bad connection is lost or sent twice.

### Session list (home screen)

- Live sessions first, then history; merged, sorted by last activity, with title, preview, model,
  workspace, relative time
- Clear state per row: running spinner, **needs you** badge (open approval or clarify), unread dot,
  pinned
- Search, pull to refresh, automatic refresh on `sessions.changed`
- Swipe or long-press: rename, pin, archive, delete (with confirmation)
- New chat button: optional workspace (from recent sessions' `cwd`) and model
- Owner follow-up (16 November 2026): choose workspace and model from searchable lists, with
  explicit gateway-default choices; no free-text values. Both new-chat and session model selectors
  request the configured-only model catalog (`explicit_only:true`) and retain provider identity.
- Keep the socket subscribed to the sessions the user has opened recently (cap around 8, detach the
  oldest idle one) so switching is instant and their notifications work

### Chat screen

- Virtualised message list tuned for streaming; batch delta updates (about every 50 ms) so the JS
  thread never stalls; stick to bottom unless the user scrolled up, with a jump-to-latest button
- Markdown with syntax-highlighted code, copy buttons, long-press to copy or select a message
- Collapsible reasoning; tool cards (name, arguments, live progress, result, diff or image when
  present); interim commentary; todo list; subagent activity as compact rows; compaction and error
  notices; context/usage readout
- Owner follow-up (16 November 2026): default to a clean chat view. A device-local **Show reasoning
  and tool activity** toggle in app settings reveals these details for both history and live output.
  This changes presentation only. Approval/clarify cards and secure-input requests always remain
  visible, as do messages, errors, notices and compaction updates.
- "Load earlier" paging through `session.transcript`
- Header: title (tap to rename), model and reasoning picker, running state, stop button
- Approval and clarify cards inline plus a sticky banner when one is open off-screen; they disappear
  when answered on another device
- `sudo` / `secret` requests as a secure input sheet

### Composer

- Owner-approved follow-up (16 November 2026): one single-line composer with camera, gallery
  attachment and send icons. Preserve pasted text and saved drafts; do not submit on Enter/paste.
  Keep attachment thumbnails and upload progress. All three icon targets are at least 48dp.
- While a turn runs: send queues by default, with steer and stop one tap away; queued prompts are
  listed above the composer and can be edited or cancelled
- Slash-command autocomplete from the gateway's own catalog
- Drafts kept per session

### Handoff behaviour to get right

- Opening a session that is mid-turn on desktop shows it running and streams from there (plus the
  partial reply if Milestone 2 found a way)
- A prompt typed on desktop appears on the phone without a refresh, and the reverse
- A gateway restart shows a calm "reconnecting" state, then recovers; a turn lost in the restart is
  shown with a discard action (`prompt.resolve_unknown`)

**Gate 3:** first installable build on the phone with list, chat, streaming, approvals and handoff
working. The owner uses it for a day before polish starts.

## 10. Milestone 5: notifications

Two tiers, because events only reach the app for sessions it is subscribed to and only while it runs.

**Tier 1, in the app.** When a subscribed session has a running turn and the app is backgrounded, a
foreground service keeps the process and socket alive (stops a few minutes after everything goes
idle; setting: off / while a turn runs / always). Local notifications for turn finished, turn failed,
approval needed, clarify needed. Tapping deep-links to the session (`hermesmobile://session/<id>`).
Notification actions for approve once / deny. No notification for the session currently on screen.

**Tier 2, from the PC, for any session with the app closed.** Hermes fires hooks inside the agent
loop for every surface: `on_human_input_request` (kind approval/clarify/sudo, redacted prompt),
`on_human_input_resolved`, `post_llm_call` (successful turn, includes the reply text),
`on_session_end` (every turn, noisy). Deliver them to the phone through a self-hosted ntfy topic on
the tailnet, with the ntfy click action set to the app's deep link:

- First choice: a small user plugin in `%LOCALAPPDATA%\hermes\plugins\phone-notify\` registering those
  hooks and POSTing to ntfy from a background thread (never block the agent thread). Enable with
  `hermes plugins enable phone-notify`, restart the gateway.
- Verify it fires for sessions started in the **desktop app**. If some turns run in managed worker
  processes where user plugins do not load, switch to `hooks.outbound` webhooks in `config.yaml`
  (registered in workers too, no consent prompt) feeding a tiny relay that reformats to ntfy.
- Filter noise: skip subagent and automatic turns (`/loop`, heartbeat, background-process turns);
  cancel the notification on `on_human_input_resolved`.
- Hook payloads carry no session title; look it up or show the first line of the prompt.

Tier 2 needs the ntfy Android app installed alongside. If the owner would rather have a single app,
the alternative is Firebase Cloud Messaging, which needs a Firebase project; ask before choosing it.

## 11. Milestone 6: polish and acceptance

Owner-approved visual direction (16 November 2026): **Warm forest v1**, designed by GPT-6.1 Sol
at extra-high effort. The owner reviewed Home/Chat and the needs-you state and explicitly authorized
implementation. Follow [the saved design contract](docs/designs/warm-forest-v1/DESIGN.md),
[Home/Chat image](docs/designs/warm-forest-v1/home-chat.png),
[needs-you image](docs/designs/warm-forest-v1/needs-you.png) and
[editable preview](docs/designs/warm-forest-v1/preview.html). The reference is illustrative;
retain real session data and existing capabilities. Immediate scope is this visual redesign plus
the requested ten-second quiet connection grace, generous back target and single-line icon composer.
Other Milestone 6 features and the acceptance checks below remain separate work.

Earlier implementation checkpoint: Warm forest native UI build passed workspace types, 104 app/helper/
preference tests and independent source review after three UI/packaging fixes. Final clean release
contained only the required icon font. Installation was then awaiting USB reconnection; later voice
updates containing this UI were installed (see PC_SETUP.md). Native appearance and behavior remain
owner acceptance, as requested. Detailed candidate evidence is in the saved contract.

Light/dark theme following the system, haptics, edge-to-edge with correct keyboard and cutout
handling, predictive back, share-sheet target (share text or an image into a new chat), launcher
shortcut for New chat.

Acceptance, on the phone with the owner:

1. Cold start to a readable session list in under two seconds (from cache), live within a few more
2. Three sessions running at once, switching between them without losing any stream
3. Start a turn on desktop, continue it on the phone, then back on desktop, with no refresh anywhere
4. Approval raised while the phone is locked: notification arrives, can be answered from it
5. Kill Wi-Fi mid-stream, restore: the reply completes with no missing or duplicated text
6. Send on a dead connection: the prompt goes out exactly once when the connection returns
7. Restart the gateway mid-session: the app recovers on its own
8. Photo from camera attached and understood by the model
9. Long tool-heavy session scrolls smoothly
10. `hermes update`, then smoke script and app still work
11. Release APK installs over the previous one (stable signing key kept outside the repo)

Finish `PC_SETUP.md` with build, install, update and token-rotation steps.

## 12. Standing risks

- **Protocol drift.** Hermes updates often and this protocol is not a public stable API. Mitigations:
  vendored contract with a sync script, the smoke test, a capability check at connect with a clear
  "Hermes was updated, the app may need updating" banner instead of silent breakage.
- **The token is the whole key.** Anyone holding it on the tailnet can run commands as the owner's
  Windows account. Keystore only, never in logs, rotation documented.
- **PC availability.** The app is only as available as the PC: it must be awake with the gateway
  running. Note Windows power settings in `PC_SETUP.md`.
- **Background limits.** Android may still kill the foreground service; Tier 2 is the safety net.

## 13. Owner-authorized follow-up: continuity-first voice (16 November 2026)

The owner explicitly added voice after reviewing the upstream options and an independent
GPT-6 Astra/high source review. This supersedes section1's initial voice exclusion for this work.
Keep the existing canonical chat, selected model and reasoning; New chat stays an explicit action.
Use gateway transcription and speech synthesis plus ordinary durable text submissions. Do not use
`voice_turn:true`, which can activate auxiliary model/reasoning settings. GPT-Live is outside this
initial mode because the inspected integration does not save every spoken exchange canonically.

The required pre-app audio smoke passed through Tailscale: local STT recognized the unchanged test
phrase using a second installed synthetic voice, Edge TTS returned decodable audio, and a reopened
own session retained context, shared user-row identity, model/provider and medium reasoning.
The first synthetic voice's word-recognition failure remains recorded. See PROTOCOL_CONTRACT.md.

Initial native scope: foreground recording in a titled existing chat, editable transcript review,
explicit Send through the existing durable outbox, and playback of a correctly identified canonical
assistant reply. Keep typed drafts, approvals and Stop task behavior. Ending voice ends microphone/
playback only. Never infer an approval from spoken assent. Bind all async audio work to immutable
endpoint/session/voice identities; discard late work after navigation, cancellation or backgrounding.
No background microphone service or new external account/provider is part of this follow-up.

Acceptance before claiming native completion: permission and late-start cancellation; session/
endpoint switching during transcription; repeated Send and lost acknowledgment; matching reply
identity with concurrent Desktop work; silence/errors; background/end cleanup; phone capture,
playback and audio routing. The owner requested to perform APK/device behavior testing personally.

Implementation checkpoint: foreground Record/Review/Send, exactly correlated reply playback,
per-message readback, Stop speaking and End voice are built. Host types, 170 tests, vendor drift,
release packaging and independent Sol source review pass. The release APK declares microphone
permission, keeps cleartext disabled, has no background microphone service and contains no deployment
token. That voice build was subsequently installed with `adb install -r` Success after the owner
completed Play Protect; phone behavior remains owner acceptance. Candidate hashes and reproduction
instructions are in PC_SETUP.md.

## 14. Owner-authorized stability and voice refinement batch (17 November 2026)

The owner requested an independent GPT-6.1 Sol/xhigh codebase audit, small simplifications retaining
behavior, reviewed/remediated changes, then the next voice batch and a morning-ready APK. Do not
install overnight or run phone behavior tests; the owner will install and test the candidate.

Phase A is reviewed: three bounded corrections for ambiguous Steer draft retention, fresh model/
reasoning metadata and visible chat storage warnings; unused declarations/imports and redundant
notification arguments/render work removed. See CODEBASE_AUDIT.md for coverage, dependency boundary
and actual evidence. No broad state/protocol rewrite or incompatible dependency migration.

Phase B follows [the voice design contract](docs/designs/voice-v2/DESIGN.md) and
[the preview shown before implementation](docs/designs/voice-v2/preview.png): assistant Markdown
formatted for speech only; complete lazy playback in bounded sections; Pause/Resume, Replay,
Back 10 seconds and speed controls; generous central mic/control and actual recording timer.
Keep the same session/model/reasoning, ordinary durable queue, typed draft, explicit transcript
review and Send, foreground-only capture, exact reply correlation and separate audio/task controls.
No hands-free listening, automatic sending, new provider/account or streamed model output.

Require meaningful lifecycle/playback/formatting tests, workspace types, offline aggregate checks,
independent source review/remediation and a verified release APK. Gateway/config/Serve/messaging
constraints remain unchanged. Record the final candidate/hash and remaining native acceptance
checks in PC_SETUP.md, with an obvious APK link for owner installation.

Completion checkpoint: the cleanup and voice batch are built and independently reviewed. Main's
222 offline tests, strict types/unused checks, contract drift, lockfile validation, long-reply
gateway synthesis and APK integrity checks passed. The final APK retains the installed signing
certificate. No phone tests or overnight installation were performed. PC_SETUP.md records the
morning candidate hash and owner acceptance checks; CODEBASE_AUDIT.md records findings/remediation
and the remaining moderate build-tool advisory.

## 15. Owner-authorized hands-free and mobile polish (17 November 2026)

The owner explicitly requested opt-in hands-free conversation, superseding section14's earlier
manual-only scope. Use the existing chat, selected model/reasoning, transcription/speech routes and
durable text queue. Review first remains available. Hands-free automatically submits after sustained
speech followed by a short silence, then listens again only after its exactly correlated completed
reply finishes playing naturally. Foreground only; stop/pause, missing metering, connection gaps,
requests and errors pause the loop. Never infer approval from voice or retry uncertain submissions
with a new identity. End voice ends audio resources, not accepted Hermes work.

Follow [the shown design](docs/designs/handsfree-v1/DESIGN.md) and
[preview](docs/designs/handsfree-v1/preview.png). Also show installed version and actual notification/
background monitor state in Settings; dismissible sheets with a top-right icon; distinct colored
session actions and haptics; stable scroll intent and history anchors; compact new-chat selectors
and an inviting empty chat. Canonical pending includes started admissions: show queued controls/counts
only for genuinely queued admissions and retain separate uncertain-delivery recovery.

Measure transcription, first text, final reply and synthesis through the real gateway without
changing selected settings. Shorten the first speech section and prefetch at most one next section.
Do not speak provisional deltas: the inspected stream has no immutable final-sentence guarantee.
Require bounded lifecycle/resource tests, types, aggregate checks, independent source review and
APK integrity. The owner retains phone behavior testing; do not run automated device tests.

Completion checkpoint: version0.2.0/build2 is built and ready to install. 248 host tests, strict
types, contract drift, dependency lock validation, two bounded gateway timing probes and final APK
integrity checks pass. Independent Sol/xhigh reviews cleared runtime repairs. Installed certificate
is retained. PC_SETUP.md records the artifact hash, measured latency and owner device acceptance;
this new candidate was not installed or tested on the phone.

Model-picker follow-up: the running gateway's `explicit_only:true` also exposes Claude Code login
models. The owner requested OpenAI and explicitly saved local/custom providers only on mobile.
Apply that policy consistently in both pickers, in addition to the gateway flag; do not change
gateway configuration, credentials or other clients. See PROTOCOL_CONTRACT.md for live evidence.


## 16. Owner-requested growing message composer (17 November 2026)

Supersedes the earlier single-line-only input: keep the empty composer compact, grow with wrapped
text and explicit newlines up to approximately six lines, then scroll inside the draft. Enter inserts
a newline; sending remains explicit. Preserve per-session drafts, queue/steer behavior, attachments
and voice controls. Bottom-align action icons as the input grows. The owner tests phone behavior.


## 17. Owner-requested notification refinement (17 November 2026)

Show the session title and a plain-text final reply preview, expandable for more detail. Distinguish
reply ready, interrupted, failed, approval and clarify states. Replace older reply alerts within
the same endpoint/session; keep separate pending requests. Preserve existing routing, safe approval
actions, replay deduplication and visible-chat suppression. Keep private Android visibility; never
include approval commands, reasoning or raw errors. Do not migrate notification channels or change
watch/sound settings. Delivery coverage remains the existing subscribed-session tier.


## 18. Owner-reported hands-free detection and feedback repair (17 November 2026)

Show real recorder levels, initial room-noise calibration, speech/pause state and pause progress.
Calibrate noise for 500ms before speech detection, with a relative start/end threshold and existing
250ms speech /1300ms quiet requirements. Calibrated continuous noise must not become a voice turn,
including saturated rooms. Retain stale/missing-meter pauses and bounded no-speech retries. Explicit
Finish speaking uses the same guarded stop/transcribe/durable-send path. Ask for brief initial quiet.
Do not invent a live transcript: the current gateway route transcribes a complete recording.
Show the recognized sent words while awaiting the exactly correlated response.

Owner separately reported a minute waiting in Review first and confirmed the session was still
running. Add elapsed waiting and explain full-reply audio. Keep the manual reply watcher alive
for long tasks instead of closing after120s; automatic unresolved-turn pause remains at120s.
Foreground/session/endpoint cancellation and selected model/reasoning stay unchanged. No claim
of reduced model execution time or proven native microphone acceptance from host tests.


## 19. Owner-approved everyday usability batch (17 November 2026)

The owner approved the recommended six-part batch after the independent Sol/xhigh research:
message actions and selected-text quotations; Find in loaded chat; loaded-session filters and
saved draft visibility; receiving shared Android text/URLs/images; model favourites; and a
verified Hermes reasoning-level picker. Keep Warm Forest, existing sessions/model/reasoning,
durable outbox, voice, recovery and credential boundaries. This does not authorize the later
bookmark/export, full-history indexing, branches, general documents, background audio or realtime
voice research projects. No new account is required for this batch.

Long-press messages opens Copy, Select text, Share, Reply about this and eligible Read aloud.
Selection quotes append to the existing draft and never submit automatically. Find explicitly
covers loaded visible messages, with bounded measured-index navigation and highlighted results.
Home filters All/Running/Needs you/Unread/Drafts, including image-only drafts and recovery work.
Favourites are device-local and retain provider identity; unavailable entries remain unavailable.

Android sharing uses a local Expo native inbox: explicit destination selection, editable review,
private durable copies, supported-image validation and bounded provider preparation. Imported text
appends to an existing draft; uploaded draft images persist through navigation/cache recovery.
A native share is discarded only after the app draft is durably saved. Importing never submits a
prompt. Text can be drafted offline; image preparation requires a reachable gateway upload route.
New chat from the share chooser explicitly uses gateway defaults. Ordinary model/reasoning remain
unchanged when sharing into an existing chat. Image cap remains10 per prompt; merged oversized
recovery drafts are retained and must be reduced before sending.

Reasoning smoke passed on an owned idle GUI fixture, then archived it: all8 Hermes vocabulary
levels and null reset round-trip, invalid level rejected, model/provider unchanged. Minimal mapped
to Low and Ultra to Max on the current OpenAI-Codex default model. This verifies canonical policy
and reported clamping, not every provider execution or a per-model native effort enum. Show
requested/effective values and explicitly handle deferred changes. No prompt/LLM turn/config edit.

Require workspace types, meaningful host/native tests, independent source review and repaired
findings, release signing/manifest/JS/icon-font/token checks. The owner retains native phone tests
for incoming intents, file grants, text selection, keyboard, search jumps, drafts and handoff.

## 20. Owner-authorized audit repairs and narrow simplification (17 November 2026)

Repair the six P2 and two P3 findings in the [source audit](docs/audits/2026-11-17-source-audit.md):
endpoint-safe deletion cleanup, queued-edit draft preservation, coherent running refresh,
post-resume failure ownership, local secure-input cancellation, uniquely owned smoke fixtures,
completed stream-buffer retention and operation-owned storage-warning recovery.

Then consolidate duplicated preference persistence, host credential parsing and secure UUID
generation, clarify caller version metadata and make the offline aggregate complete. Keep the
changes small and preserve existing behavior outside the explicit repairs. Broad UI/state/voice
rewrites, dependency migrations and signing changes are not part of this batch.

Require focused regression tests, applicable offline/type/contract checks, independent
GPT-6.1 Sol review at extra-high effort, remediation of review findings, and a verified final APK.
Target version 0.3.1/build 8. Building does not authorize installation or phone behavior tests.
Gateway restart, credential/configuration, Tailscale and messaging rules remain unchanged.


## Owner-authorized conversational follow-up — 18 November 2026

The owner authorized implementing the conversational proposal, committing the reviewed 0.3.1 baseline separately, and proceeding after independent GPT-6.1 Sol / Extra High review and remediation per phase. Stop only for consequential configuration changes or real blockers. This supersedes earlier planning-only implementation gates, while preserving existing runtime, phone-installation, inference/resource and secret-handling boundaries.

The 0.3.2 (9) owner-test preview implements timing diagnostics, per-session presets, shared speech controls and draft handoff, observed task visibility and accessible foreground audio controls. Native duplex voice is evaluated and deferred because canonical external-turn commit and included-credit hard stops are unavailable. No new plans, paid credit purchases, provider inference or Home Dashboard/Hermes configuration changes were made. The [execution record](docs/plans/conversational-experience-execution.md) records reviews and fixes; the [release record](docs/releases/0.3.2.md) separates host/build evidence from open device/performance acceptance. No phone installation is authorized by producing this preview.
