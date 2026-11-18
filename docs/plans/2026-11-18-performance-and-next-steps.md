# Performance, refinement and next-feature plan

Written 18 November 2026 against branch `codex/fullscreen-handsfree` at `fa59f96` (app 0.3.3, versionCode 10).

This is a source review plus an implementation plan. Nothing here has been implemented, and nothing
was measured on a phone. Every finding comes from reading the code; each one says what to measure
before and after. Line numbers refer to the commit above and will drift.

## How to use this document

Each work package (WP) is self-contained: goal, evidence, files, steps, invariants, acceptance
checks, risk and a suggested model. Pick one WP per branch and per pull request.

Rules that apply to every WP:

- Read `PLAN.md` section 4, `docs/development.md` ("Change workflow", "Compatibility constraints")
  and `CONTRIBUTING.md` first. They are binding. In particular: do not modify the Hermes checkout,
  do not edit files under `packages/hermes-protocol/src/vendor/`, do not restart the gateway, never
  print or commit the token, and do not install on the phone without owner authorization.
- Required checks before calling a WP done: `npm run typecheck` and `npm run test:host`. Add tests
  for the behaviour you change. If a WP touches `app.json`, plugins or dependencies, a full prebuild
  and `npm run android:preview` are also required.
- Durability and isolation safeguards are load-bearing. The state manager's endpoint epochs,
  navigation revisions, draft revisions, outbox ordering, alias resolution and "persist before
  submit" rule exist because earlier audits found real failures. A WP may make them cheaper. It may
  not remove them. `app/src/state/manager.test.ts` is the safety net; it must keep passing unchanged
  unless a WP says otherwise.
- State what you could not verify on a device in the pull request.

Suggested model per WP: **Opus 5.5** where the change crosses the persistence, recovery or protocol
layer and a mistake loses user data; **Sonnet 5.5** for contained UI, tuning and tooling work.

## Decisions already made

The owner delegated these three choices on 18 November 2026. Treat them as settled; do not reopen
them inside a work package.

1. **Formatting lands first.** WP-6.1's Prettier commit is the first change, alone, before any other
   branch is cut. Every other WP branches from after it. It must be based on
   `codex/fullscreen-handsfree` (`fa59f96`), not `main`: at the time of writing `main` is 13 commits
   behind and does not contain the 0.3.1 to 0.3.3 work this plan reviews.
2. **End-of-speech silence stays at 1.3 s by default.** WP-3.2 adds the setting (0.8 s, 1.0 s,
   1.3 s) and does not change the default. A cut-off sentence costs a whole wasted turn; 300 ms of
   extra wait does not. Revisit the default only with phone measurements from WP-0.1.
3. **No new native dependencies in this plan.** Do not add `expo-image` or `expo-splash-screen`.
   Use the no-dependency routes in WP-2.5 and WP-4.2. A new native module forces a full prebuild
   against a signing identity that has no verified backup, for gains the plain routes mostly deliver.

## What the app is today

Expo SDK 58, React Native 0.88.1 (new architecture, Hermes engine, R8 shrinking), React 19.3, one
Android target. First-party code is the app under `app/src/` and a 700-line protocol client, with
roughly 400 offline checks.

| Area | Where | Notes |
| --- | --- | --- |
| Shell | `app/App.tsx` | Conditional rendering of Setup, Home or Chat. No navigation library. |
| Session list | `app/src/screens/HomeScreen.tsx` | Filters, search, create sheet, settings, session actions. |
| Chat | `app/src/screens/ChatScreen.tsx` (1,282 lines, one component) | Timeline, composer, find, settings, tasks, voice host. |
| State | `app/src/state/index.ts` (`AppManager`) | Store, SQLite cache, outbox, drafts, HTTP media adapters. |
| Protocol | `packages/hermes-protocol/src/client.ts` | WebSocket JSON-RPC, replay, resume, durable submit. |
| Voice | `app/src/components/VoiceSheet.tsx`, `voiceController.ts`, `voicePlayback*.ts`, `voiceActivity.ts` | File-based STT, final-reply TTS, hands-free VAD. |
| Notifications | `app/src/notifications.ts` | Notifee local notifications and foreground monitor. |
| Sharing | `app/src/sharing/`, `app/modules/hermes-sharing/` | Incoming Android shares. |

`PERFORMANCE_AUDIT.md` (16 November) already fixed the worst algorithmic problems: draft
checkpoints, activity compaction, selector subscriptions, inventory coalescing, image read sharing.
It also named what it did not fix: "Live Markdown still parses the growing response" and no device
frame, startup or memory measurements. This plan starts from there.

## Where the lag most likely comes from

Ranked by expected effect on what the user feels. "Expected" is a judgement from the code, not a
measurement.

| # | Finding | Evidence | Felt as |
| --- | --- | --- | --- |
| 1 | The whole app state is serialized into one SQLite row on hot paths. | `persist()` at `state/index.ts:103-119` stringifies every session row and every cached chat. `scheduleCache()` (`:145`) fires it every 500 ms while events arrive. The earlier audit's own fixture puts one full payload at about 1.7 MB with eight cached chats (137,326,080 bytes over 80 writes). | Stutter while a reply streams; slow send; slow chat open. |
| 2 | Sending serializes the full state three times, two of them before the request leaves. | `sendWork` awaits `persist()` (`:480`), then `client.submit` calls `persistSubmission` which awaits `persist()` again (`:300`, `client.ts:652`), then `acknowledgeSubmission` persists a third time (`:301`). | Delay between tapping Send and the turn starting. |
| 3 | Opening a chat waits for a full persist before asking the gateway for the session. | `openSession` at `state/index.ts:442`: `await this.persist()` precedes `client.openSession`. | Delay before fresh history appears. |
| 4 | The streaming reply is re-parsed as Markdown from the start on every 50 ms flush. | Events flush every 50 ms (`:297`, `:319-327`). `ChatScreen.tsx:668-676` builds a new live item object each time, so `Message` re-renders and `react-native-markdown-display` re-parses the entire growing text. `extractImages` also re-scans it (`:133`). Cost grows quadratically with reply length. | Frame drops that get worse the longer the reply. |
| 5 | Every keystroke re-renders the entire chat screen. | The draft lives in the global store. `ChatScreen.tsx:418` selects `s.drafts`, and `MessageInput` is controlled by it (`:1204`). Each key press: store update, full `ChatScreen` render, a draft SQLite write (`:444`), and a debounced slash-completion effect. | Typing lag, worst in long chats. |
| 6 | `ChatScreen` subscribes to more than it shows. | Same selector takes all `sessions`, `outbox` and `queuedEdits`. A flag change on any other session re-renders the open chat. | Background jank while other sessions run. |
| 7 | Reconnect recovers sessions one at a time before reporting ready. | `client.ts:229`: `for (const session of this.sessions.values()) await this.recoverSession(...)`. Up to eight sessions, two round trips each, in series, before `setState('ready')`. | Long "reconnecting" after returning to the app. |
| 8 | A dead socket can look healthy for up to 45 s after the app resumes. | Foreground only calls `reconnectNow()`, which returns immediately when state is `ready` (`client.ts:284-289`). Heartbeat is 15 s interval, 45 s deadline; request timeout is 120 s. | A send that hangs after unlocking the phone. |
| 9 | Voice uploads music-quality audio for speech recognition. | `VoiceSheet.tsx:32` uses `RecordingPresets.HIGH_QUALITY`: 44.1 kHz, stereo, 128 kbps. The file is then base64-encoded into JSON (`:59`). | Slower transcription on every voice turn. |
| 10 | Every voice turn pays fixed waits. | 500 ms calibration and 1,300 ms end-of-speech silence (`voiceActivity.ts:10`), 400 ms cooldown (`voiceController.ts:71`), a permission call and recorder prepare per turn, and TTS starts only after the full reply with a first section of up to 320 characters (`voiceText.ts:28`). | Slow conversational rhythm. |
| 11 | Images travel and live as base64 strings. | Picker requests `base64: true` for up to ten originals (`ChatScreen.tsx:561-571`) with no downscaling; uploads are JSON data URLs (`state/index.ts:646`). Tool images are fetched as data URLs and kept in a JS-heap cache (`:601-614`, `imageReads.ts`). | Slow attach, memory pressure, slow image display. |
| 12 | A configured user sees the setup form at launch. | `App.tsx:42` renders `SetupScreen` while `credentialsConfigured` is still false, which is the case until `init()` finishes reading SQLite and SecureStore. | A flash of the wrong screen on cold start. |

Two findings that are not performance but should be fixed in the same pass:

- **No Android back handling.** There is no `BackHandler` anywhere in `app/`. Screens are swapped by
  conditional rendering, so the system back gesture inside a chat most likely leaves the app instead
  of returning to the session list. Confirm on the device.
- **Home loses its place.** `HomeScreen` unmounts whenever a chat is open (`App.tsx:49-53`), so
  scroll position, search text and the selected filter reset every time the user comes back.

## Phase 0: measure first

### WP-0.1 Timing and render instrumentation

- **Goal.** Make every later WP provable. Today's diagnostics cover voice stages only.
- **Files.** `app/src/state/conversationDiagnostics.ts` and its test, `app/src/state/index.ts`,
  `app/src/screens/HomeScreen.tsx` (the existing "Copy response timings" button),
  `tools/smoke/timing-summary.mjs`.
- **Steps.**
  1. Add stages: `first_delta` (first `message.delta` for the traced submission), `submit_sent`
     (just before `prompt.submit`), `tts_request_start`, `tts_ready`.
  2. Add a second, separate channel of duration samples that are not tied to a trace:
     `persist_ms` with payload byte length, `session_open_ms`, `connect_ready_ms`,
     `cache_restore_ms`. Keep the ring-buffer cap and the opt-in switch.
  3. Add a development-only render counter (a tiny hook that increments a named counter per commit)
     for `ChatScreen`, the timeline, the live message and the composer. Export counts with the
     timings. Compile it out or no-op it when diagnostics are off.
  4. Keep the existing rule: content-free. No text, titles, IDs or addresses.
  5. Extend `timing-summary.mjs` to print percentiles for the new samples.
- **Device procedure to document in `docs/verification.md`.** Build the Preview variant, then record
  frame statistics with `adb shell dumpsys gfxinfo net.taild39a23.hermesmobile framestats` during
  three scripted scenarios: typing 200 characters into a 50-row chat, a 4,000-character streamed
  reply, and opening five chats in sequence. Save results under `.artifacts/`.
- **Acceptance.** Host tests for the new stages and caps. A baseline capture from the owner's phone
  attached to the pull request, or an explicit note that the phone was unavailable.
- **Risk.** Low. **Model.** Sonnet 5.5.

### WP-0.2 Tracked host benchmarks

- **Goal.** The 16 November audit's fixtures live in ignored `.artifacts/`. Put reproducible
  benchmarks in the repository so regressions are visible.
- **Steps.** Add `tools/bench/` with Node scripts that drive `AppManager` through fake adapters (the
  pattern already used in `manager.test.ts`): bytes serialized per streamed reply, bytes per send,
  Markdown parses per streamed reply, renders per keystroke. Add `npm run bench`. Do not put timing
  thresholds in CI; assert on counts and bytes only.
- **Risk.** Low. **Model.** Sonnet 5.5.

## Phase 1: hot paths

Do these in order. WP-1.1 and WP-1.2 are small and should land before the larger WP-1.3.

### WP-1.1 Stop blocking the network on full persists

- **Goal.** Remove full-state serialization from the send and open paths without weakening
  durability.
- **Files.** `app/src/state/index.ts`, `app/src/state/manager.test.ts`.
- **Steps.**
  1. In `openSession` (`:442`), start `persist()` and `client.openSession()` together and await
     both. Keep the endpoint-epoch check after each. If the persist rejects, the method must still
     reject as it does today.
  2. In `persistSubmission` (`:300`), skip the second write when `sendWork` has already durably
     saved this exact submission. Track it with a `Set` of submission IDs added only after the
     `sendWork` persist resolves, and removed on acknowledge, discard or failure. A submission that
     reaches `drain()` by any other route (cache restore, retry) must still persist first.
  3. Leave `acknowledgeSubmission` alone for now; WP-1.3 makes it cheap.
- **Invariants.** A submission must be on disk before `prompt.submit` is sent. An acknowledged
  submission must not reappear in the outbox after a restart. Order by `enqueue_order` is unchanged.
- **Acceptance.** New tests: one send performs exactly one persist before the RPC; a retried
  submission still persists before the RPC; `openSession` issues `session.resume` without waiting
  for a blocked write (use the blocked-database fixture pattern already in `manager.test.ts`).
- **Risk.** Medium. **Model.** Opus 5.5.

### WP-1.2 Throttle cache writes while streaming

- **Goal.** Stop writing megabytes twice a second during a reply.
- **Files.** `app/src/state/index.ts`.
- **Steps.**
  1. First establish whether cold-start recovery depends on a persisted `liveText` or `blocks`.
     Read `snapshotChat` (`reducer.ts:31-37`) and the recovery tests. If nothing depends on it,
     exclude `liveText` and `blocks` of running chats from the payload. If something does, keep them.
  2. Change `scheduleCache` so that changes caused only by `message.delta` and activity events use a
     long interval (3 to 5 s), while structural changes (snapshot, `message.complete`, prompts,
     transcript refresh, session flags) keep 500 ms. A pending long timer must be shortened when a
     structural change arrives.
  3. Flush immediately when the app goes to background (`AppState` change to non-active).
- **Invariants.** Draft checkpoints and outbox writes are not on this path and must stay immediate.
- **Acceptance.** Benchmark from WP-0.2: bytes serialized during a 4,000-character streamed reply
  drop by at least 80 percent. Existing recovery tests pass.
- **Risk.** Low to medium. **Model.** Sonnet 5.5, with step 1 written up in the pull request.

### WP-1.3 Split the cache into rows

- **Goal.** Make every write proportional to what changed. This is the structural fix behind
  findings 1 to 3 and it enables keeping more chats on disk than in memory.
- **Files.** `app/src/state/index.ts` (extract a new `app/src/state/persistence.ts`),
  `manager.test.ts`, `docs/adr/0004-durable-delivery-and-recovery.md` (amend), `docs/architecture.md`.
- **Design.**
  - Keep the `app_cache(key, value)` table. Replace the single `state:<origin>` blob with:
    `meta:<origin>` (sessions, recent, nextOrdinal, historyTruncated, draftRevision),
    `outbox:<origin>` (outbox and queuedEdits), `chat:<origin>:<sessionId>` (one chat each), and the
    existing `drafts:<origin>`.
  - Track dirty keys in `update()` by reference comparison of the previous and next state. A persist
    writes only dirty rows, inside one transaction (`withTransactionAsync` or
    `withExclusiveTransactionAsync`; check the expo-sqlite 58 API) so a crash cannot leave the
    outbox and its chat's `localMessages` out of step.
  - Deleting a chat from memory (`trimIdleChats`) must not delete its row unless the chat is being
    forgotten; evicted chats can stay on disk under a row-count cap (suggest 50) so reopening a
    recent chat shows cached history at once.
  - Migration: on first start, if `state:<origin>` exists and `meta:<origin>` does not, write the
    new rows in one transaction, then delete the old row. Keep reading the legacy unversioned
    `state` key exactly as today.
- **Invariants to carry over, each with an existing test to keep green.** Draft revision ordering
  against full checkpoints (`withDraftCheckpoint`); the `commitSource`, `commitTarget` and
  `pendingCaches` hand-off during `configure()`; `mergeUnbound` conflict detection; origin scoping;
  storage-warning coverage (`clearCoveredWarning`); the serialized `writes` chain.
- **Acceptance.** Full `manager.test.ts` passes. New tests: migration from a v1 blob; crash between
  rows (simulate a failed transaction) restores a consistent state; one send writes the outbox row
  and one chat row only; streaming writes one chat row. Benchmark: bytes per send fall by more than
  95 percent with eight cached chats.
- **Risk.** High. This is the durability core. Request an independent review before merge.
- **Model.** Opus 5.5.

### WP-1.4 Isolate the composer

- **Goal.** Typing re-renders the composer only.
- **Files.** `app/src/screens/ChatScreen.tsx`, new `app/src/components/Composer.tsx`,
  `app/src/components/MessageInput.tsx`, `app/src/state/index.ts`.
- **Steps.**
  1. Move the input row, slash suggestions (`ChatScreen.tsx:517-546`, `:1185-1201`) and the
     send/voice buttons into `Composer`. It holds the text in local state.
  2. Sync local text to `appManager.setDraft` on a 200 to 300 ms trailing debounce, and flush
     synchronously on send, steer, replace-queued, blur, unmount, session change and app background.
  3. External draft changes must still appear: quoting (`onQuote`, `:737-741`), "Edit queued"
     (`:1122-1127`), slash prefill and alias, shared-draft import, voice "Type instead". Subscribe
     to `s.drafts[id]` and adopt the store value whenever it differs from the last value this
     composer wrote.
  4. `ChatScreen` stops selecting `s.drafts`. Call sites that need the draft at action time read
     `appManager.getState().drafts[id]` after forcing a flush.
  5. Debounce the SQLite draft checkpoint inside `setDraft` the same way, with a flush on
     background. Keep the revision counter semantics.
- **Invariants.** `replaceDraftIfUnchanged`, `captureDraft` and `replaceCapturedDraft` compare
  against the store value; flush before calling them. A draft typed more than 300 ms before the
  process dies must survive.
- **Acceptance.** Render counter from WP-0.1: typing 20 characters produces zero `ChatScreen` and
  zero timeline commits. Tests for flush-on-send and adopt-external-change.
- **Risk.** Medium (draft loss if a flush is missed). **Model.** Opus 5.5.

### WP-1.5 Make the streaming reply cheap to render

- **Goal.** Per-flush work is proportional to the new text, not the whole reply.
- **Files.** `app/src/screens/ChatScreen.tsx`, new `app/src/components/LiveMessage.tsx` and
  `app/src/components/markdownBlocks.ts` with tests.
- **Steps.**
  1. Give the timeline a stable placeholder item for the live reply (present while
     `chat.liveText` is non-empty) so `items` no longer changes per delta. `LiveMessage` subscribes
     to `s.chats[id]?.liveText` itself.
  2. Write `splitStableBlocks(text)`: returns completed top-level blocks plus the unfinished tail.
     Split at blank lines that are outside a fenced code block. An unclosed fence keeps everything
     from its opening line in the tail.
  3. Render each completed block with a memoized component keyed by index, so it parses once. Only
     the tail re-parses per flush. While a fence is open, render the tail as plain monospace text.
  4. Skip `extractImages` on the live text; the completed message handles images.
  5. Hoist the `rules` and `style` objects passed to `<Markdown>` (`:180-196`) to module constants,
     one pair for assistant and one for user bubbles. The `text` rule needs the search query; build
     it with `useMemo` keyed on the query.
  6. Optional, after measuring: lengthen the flush timer from 50 ms toward 100 ms once `liveText`
     exceeds a few thousand characters.
- **Acceptance.** Benchmark: Markdown parse input bytes for a 4,000-character reply delivered in
  100 deltas fall from roughly 200,000 to under 20,000. Unit tests for the splitter covering nested
  fences, lists, tables and a tail that ends mid-fence. Visual check that block splitting does not
  change spacing between paragraphs and lists (loose versus tight lists are the likely trap).
- **Risk.** Medium (rendering differences). **Model.** Opus 5.5 for the splitter, Sonnet 5.5 for the
  rest.

### WP-1.6 Break up `ChatScreen` and narrow its subscriptions

- **Goal.** Updates touch only the part of the screen that shows them.
- **Files.** `app/src/screens/ChatScreen.tsx`, new files under `app/src/screens/chat/`.
- **Steps.**
  1. Extract, with no behaviour change: `ChatHeader`, `FindBar`, `Timeline`, `StatusRow`,
     `OutboxFailures`, `QueuedPrompts`, `AttachmentStrip`, `ChatSettingsSheet`, `VoiceHost`.
  2. Each subscribes to exactly what it shows. Selecting a filtered array in a selector defeats the
     shallow comparison in `useAppStore` (`state/index.ts:657-668`) because it is a new array every
     time; select the source arrays and filter with `useMemo`, or add a small memoized-selector
     helper.
  3. Select the session row with `s.sessions.find(...)` instead of the whole array.
  4. Mount `ChatSettingsSheet` and `TaskTray` contents only while open.
  5. Wrap `LocalMessage`, `Activity` and `Prompt` in `React.memo`. Give the `FlatList` stable
     handler props (`:968-971` are inline closures today).
  6. Wrap `Code` (`:75-113`) in `React.memo` and skip token colouring above a size limit (suggest
     20,000 characters); it creates one `Text` per token on every render.
- **Acceptance.** Render counters: a streamed reply in another session causes zero commits in the
  open chat; a status change re-renders `StatusRow` only. All existing tests pass.
- **Risk.** Medium: the file's many epoch and revision guards must move intact. Do it as pure
  extraction commits first, then narrowing commits. **Model.** Opus 5.5.

### WP-1.7 Timeline list behaviour

- **Goal.** Opening a chat shows the latest messages immediately, and scrolling back does not
  re-parse.
- **Steps.**
  1. Cache the parsed Markdown tree per history row. `react-native-markdown-display` 7.0.2 accepts a
     pre-built tree in place of a string (`src/lib/parser.js` returns `renderer(source)` when
     `source` is an array). Build it with the library's exported helpers and keep it in a
     `WeakMap` keyed by the row object, or an LRU keyed by `row_id`. Virtualized cells that scroll
     out and back then skip parsing.
  2. Set explicit `initialNumToRender`, `maxToRenderPerBatch` and `windowSize` on the chat
     `FlatList` (`:964-983`) and choose values from the WP-0.1 frame captures.
  3. Evaluate an inverted list so the newest rows render first and no `scrollToEnd` pass is needed.
     This interacts with `FollowLatest`, find-in-chat jumps, "Load earlier" and
     `maintainVisibleContentPosition`. Prototype behind a constant, measure, and only switch if
     chat-open frames improve. Do not adopt a new list library without the same measurement.
- **Risk.** Step 1 low, step 3 medium to high. **Model.** Sonnet 5.5 for steps 1 and 2, Opus 5.5 for
  step 3.

## Phase 2: connection, send and media

### WP-2.1 Faster reconnect

- **Files.** `packages/hermes-protocol/src/client.ts` (first-party; not under `vendor/`),
  `packages/hermes-protocol/test/`, `app/src/state/index.ts`.
- **Steps.**
  1. In `dial()` (`client.ts:229`), recover sessions concurrently. Each session has its own `hold`
     queue and cursor, and the channel already multiplexes requests by ID. Cap concurrency at 3 or 4.
  2. Keep "ready only after recovery" unless tests show it is safe to report ready after the first
     session; do not change that contract casually, since `drain()` relies on it.
  3. In `AppManager.reopen()` (`state/index.ts:349`), open the active session first, then the rest
     with the same concurrency cap, and call `drain()` as soon as the active session is open rather
     than after all eight.
- **Acceptance.** Fake-gateway tests: recovery of eight sessions issues overlapping requests; event
  ordering per session is unchanged; a `not_found` on one session does not fail the others; the
  existing audit-regression tests pass.
- **Risk.** Medium to high (replay ordering). **Model.** Opus 5.5.

### WP-2.2 Detect a dead socket on resume

- **Steps.** Add `CanonicalClient.probe(timeoutMs)`: when state is `ready`, send one cheap request
  (for example `runtime.describe`) with a 4 to 5 s timeout and retire the socket if it fails. Call
  it from the `AppState` active handler and the NetInfo handler in `init()`
  (`state/index.ts:172-175`) when the app was in the background for more than about 20 s. Coalesce
  concurrent probes.
- **Acceptance.** Test with a fake socket that stops answering: the client reaches `reconnecting`
  within the probe timeout instead of the 45 s heartbeat deadline. A healthy socket is untouched.
- **Risk.** Low to medium. **Model.** Sonnet 5.5.

### WP-2.3 Calm the session-inventory refresh

- **Evidence.** Every `sessions.changed` event triggers two `session.list` calls of up to 200 rows
  each, a merge, and a full persist (`state/index.ts:297`, `:424`). Flights are coalesced but there
  is no minimum spacing.
- **Steps.** Add a trailing 1 to 2 s minimum interval between inventory refreshes, with an immediate
  path for explicit user actions (pull to refresh, create, mutate). Skip the store update when the
  merged list is deeply equal to the current one.
- **Risk.** Low. **Model.** Sonnet 5.5.

### WP-2.4 Image attach pipeline

- **Files.** `app/src/screens/ChatScreen.tsx` (`attach`, `:547-612`), `app/src/state/index.ts`
  (`uploadImage`).
- **Steps.**
  1. Stop requesting `base64: true` from the picker. Process assets one at a time: downscale with
     `expo-image-manipulator` so the long edge is at most 2,048 px (make it a named constant), JPEG
     quality about 0.8, then read base64 for that one file, upload, release.
  2. Keep PNG for small images with transparency if the gateway needs it; otherwise JPEG.
  3. Upload two at a time. Show per-image progress in the attachment strip instead of one global
     "uploading" flag.
- **Invariants.** The ten-image limit, the 25 MiB guard, `assertAttachmentScope()` after every
  await, and HEIC conversion.
- **Acceptance.** A 12 MP photo uploads as a file under about 1 MB. Scope-change tests still pass.
- **Risk.** Low to medium. **Model.** Sonnet 5.5.

### WP-2.5 Image display from files, not strings

- **Steps.** Change `readImage` so the fetched data URL is written once to a cache file
  (`Paths.cache`, name derived from a hash of origin, session and path) and the UI receives a
  `file://` URI. Replace the in-heap string LRU in `imageReads.ts` with a file LRU bounded by total
  bytes; keep flight sharing, cancellation and the clear-on-gateway-change rule (delete that
  origin's files). Give tool images a tap-to-view full-screen sheet with pinch zoom.
- **Decided.** Do not add `expo-image`. The steps above use React Native's `Image` with file URIs
  and need no new dependency.
- **Risk.** Medium (cache invalidation, cleanup on gateway change). **Model.** Sonnet 5.5.

## Phase 3: voice latency

The 17 November measurements give the budget: about 1.2 s transcription, 1.6 s to first text, 2.2 s
to completion, and 1.2 s to synthesize 320 characters versus 8.3 s for 1,900. On top of that the app
adds fixed waits. Use `tools/smoke/voice-latency.mjs` and the WP-0.1 stages to measure each change.

### WP-3.1 Speech-sized recordings

- **Steps.** Replace `RecordingPresets.HIGH_QUALITY` (`VoiceSheet.tsx:32`; 44.1 kHz stereo 128 kbps)
  with explicit options: mono, 16 kHz, 24 to 32 kbps AAC in `.m4a`, metering on. Confirm with the
  audio smoke probe that `/api/audio/transcribe` accepts it and that accuracy is unchanged on the
  existing fixture before changing the default.
- **Expected effect.** Upload and base64 size fall by roughly four to five times.
- **Risk.** Low. **Model.** Sonnet 5.5.

### WP-3.2 Trim fixed per-turn waits

- **Steps.**
  1. Ask for microphone permission once per voice session instead of every turn
     (`VoiceSheet.tsx:54`); re-check only after a failure.
  2. Carry the calibrated noise floor from one turn to the next within a voice session. Seed
     `VoiceActivity` with it and shorten calibration for later turns from 500 ms to about 150 ms.
     Keep the fail-closed behaviour for loud rooms.
  3. Make end-of-speech silence a setting with three steps: 0.8 s, 1.0 s and 1.3 s. Decided: the
     default stays 1.3 s. Store it with the other preferences and put it in Home settings.
  4. Review whether the 400 ms cooldown (`voiceController.ts:71`) is still needed after speech ends;
     it exists to avoid recording the tail of playback, so test with speaker and with a headset.
- **Acceptance.** Extended `voiceActivity.test.ts` and `voiceController.test.ts`. Quiet-room and
  noisy-room acceptance on the phone remains the owner's.
- **Risk.** Medium (false endpoints). **Model.** Opus 5.5.

### WP-3.3 Earlier first audio

- **Steps.**
  1. Graduated speech sections in `speechParts` (`voiceText.ts:28-41`): first section is the first
     sentence up to about 160 characters, then about 400, then about 900, then the current limit.
     The player prefetches only one section ahead, so sizes must grow gradually or playback will
     outrun synthesis and leave a gap.
  2. Behind a setting, speculative synthesis: while the reply is still streaming, once the first
     sentence is complete, request its audio. At completion, use it only if the final text's first
     section is identical; otherwise discard it. The existing rule that only the authoritative,
     correlated final reply is spoken stays intact, because nothing plays before completion.
- **Cost.** Step 2 spends one extra synthesis call whenever the final text differs. Default off
  until measured.
- **Risk.** Medium. **Model.** Opus 5.5.

## Phase 4: UX refinements

| WP | Change | Notes | Model |
| --- | --- | --- | --- |
| 4.1 | Android back handling | Register `BackHandler` in `App.tsx`: close find if open, else chat to home, else default. Verify with predictive back enabled in `app.json`. | Sonnet 5.5 |
| 4.2 | No setup flash at launch | Add an `initialized` flag to the store, set at the end of `init()`. Render a plain view in the splash background colour until then. Decided: do not add `expo-splash-screen`. | Sonnet 5.5 |
| 4.3 | Home keeps its place | Lift search text, filter and scroll offset out of `HomeScreen` into a small module store and restore them on mount. Alternative: keep Home mounted beneath Chat using React's `Activity` (exported by the installed React; confirm React Native 0.88 support first). | Sonnet 5.5 |
| 4.4 | Session list rendering | Extract a memoized `SessionListItem`; make `renderItem` and `keyExtractor` stable (`HomeScreen.tsx:227-294`). Refresh relative ages once a minute. | Sonnet 5.5 |
| 4.5 | Screen transitions | A short native-driver slide or fade between Home and Chat, disabled when reduce-motion is on. Instant swaps read as jank even when fast. | Sonnet 5.5 |
| 4.6 | Waiting state | Between send and the first delta, show a placeholder assistant bubble in the timeline rather than only the status row. | Sonnet 5.5 |
| 4.7 | Code blocks | Horizontal scroll instead of wrapping, a language label, an icon copy button with confirmation. | Sonnet 5.5 |
| 4.8 | Error presentation | 26 call sites pass `String(e)` to `Alert.alert`, which prints "Error: ..." text. Add one helper that maps known failures to plain sentences and uses a non-blocking banner for recoverable ones. | Sonnet 5.5 |
| 4.9 | Startup database opens | Three databases open synchronously at import (`notifications.ts:10`, `state/taskStore.ts:7`, `preferenceDatabase.ts:3`), besides the main cache. Measure with WP-0.1; open the notification and task databases lazily if it matters. | Sonnet 5.5 |

## Phase 5: next features

Ordered by value for a phone companion to a desktop agent, and by how well they build on the phases
above. `docs/STATUS.md` says to consult `PLAN.md` and the owner before starting a new batch; these
are proposals.

1. **Instant open for recent chats (builds on WP-1.3).** Keep the last 50 chats' transcripts on
   disk, eight in memory. Show cached history immediately and reconcile when the snapshot arrives.
2. **Launcher shortcuts.** Static and dynamic app shortcuts for "New voice conversation", "New chat"
   and the three most recent chats, through a config plugin and the existing `hermesmobile://`
   routing. Optionally a quick-settings tile for voice.
3. **Edit, retry and branch from a message.** The client already sends `branch` and `rewind`
   mutations. Add message actions: "Branch from here", "Edit and resend" for the last user message,
   "Regenerate". Each needs a protocol observation in `PROTOCOL_CONTRACT.md` first.
4. **Richer activity cards.** Render `inline_diff` as a real diff, collapse long tool output with
   "show more", and when activity is hidden show a one-line summary ("Ran 5 tools") so long silent
   turns do not look stalled.
5. **Export and share a conversation.** Markdown export of loaded messages through the Android
   share sheet. Listed as future scope in STATUS.
6. **Files beyond images.** Attach and receive documents (PDF, text, archives). Needs gateway
   upload support to be confirmed.
7. **Notification controls.** Per-chat mute and quiet hours. Closed-app delivery still depends on
   the ntfy path or on Firebase, which needs the owner's approval.
8. **Themes.** Light theme and Material You colours. `theme.ts` is a single dark palette and many
   components hard-code hex values, so this starts with a token sweep.
9. **Full-history search and session pagination.** Blocked on the gateway's 200-row inventory cap;
   see upstream items.

Kept deferred, as the ADRs already decide: background microphone, native duplex voice.

## Phase 6: maintainability

These make every other WP safer for an agent to implement.

### WP-6.1 Formatter and linter

- **Evidence.** There is an `.editorconfig` but no Prettier or ESLint. `state/index.ts` has 38 lines
  over 300 characters (the longest is 2,919), `ChatScreen.tsx` has 34, `VoiceSheet.tsx` 23. Edits
  to such lines are hard to target and reviews cannot see what changed.
- **Steps.** Add Prettier and run it once across `app/` and `packages/hermes-protocol/src` and
  `test`, excluding `vendor/`. Land that as a single commit with no other change, and add the hash
  to a `.git-blame-ignore-revs` file. Then add ESLint with `eslint-plugin-react-hooks`; fix or
  explicitly annotate each `exhaustive-deps` finding rather than bulk-disabling. Add `npm run lint`
  to CI.
- **Sequencing.** Decided: the Prettier commit goes first, alone, before any other branch is cut.
  ESLint and its fixes can follow as a second pull request.
- **Risk.** Low, but verify the bundle still builds. **Model.** Sonnet 5.5.

### WP-6.2 Split the state manager

Extract from `state/index.ts` without changing behaviour: `persistence.ts` (WP-1.3), `outbox.ts`
(send, drain, retry, discard), `sessions.ts` (inventory, open, alias, trim), `media.ts` (image and
audio HTTP), `store.ts` (`useAppStore`). `manager.test.ts` must pass unchanged. **Model.** Opus 5.5.

### WP-6.3 Normalize transcript rows once

Rows are `unknown` and every consumer re-derives fields with `obj()` casts, `extractImages` and
`historyMessageContent` at render and filter time. Add a normalizer at ingestion (snapshot,
transcript page, completion) that produces a typed view model per row: stable key, role, visible
text for both activity settings, images, reasoning. Cache it in a `WeakMap` keyed by the raw row so
the persisted shape does not change. **Model.** Opus 5.5.

### WP-6.4 Render-count regression tests

Add React Native Testing Library and assert commit counts for the scenarios in WP-1.4 to WP-1.6.
These are the guard that keeps the gains. **Model.** Sonnet 5.5.

### WP-6.5 React Compiler evaluation

The installed Expo config types include `experiments.reactCompiler`. After WP-6.1, try enabling it
on a branch and compare render counts and frame captures. Several components write to refs during
render (`ChatScreen.tsx:693-694`, `HomeScreen.tsx:124`); the compiler skips components that break
the rules, so fix those first. Treat this as an experiment with a written result, not a default.
**Model.** Sonnet 5.5.

## Items that need Hermes itself

Not actionable in this repository. Record them as upstream requests. For each, the app-side
mitigation is noted.

| Upstream change | Why | App-side mitigation here |
| --- | --- | --- |
| Tail-limited `session.resume` display projection | If the snapshot carries the whole transcript, chat open scales with history. Verify what the gateway sends for a long session before filing. | None; the app already pages with `session.transcript`. |
| Binary endpoints for images and audio | Base64 in JSON adds a third to every transfer and forces large strings through the JS heap. | WP-2.4, WP-2.5, WP-3.1 |
| Streaming or sentence-level TTS | First audio currently waits for a whole section. | WP-3.3 |
| Streaming STT | Removes the upload-then-wait step. | WP-3.1 |
| Incremental `sessions.changed` payloads and list pagination | Avoids refetching 400 rows; lifts the 200-session search cap. | WP-2.3 |
| WebSocket compression | Smaller frames over a relayed Tailscale path. | None |
| Server-side delta coalescing | Fewer, larger frames on slow links. | The 50 ms client batch already exists. |

## Suggested order

1. WP-6.1's Prettier commit on its own. Then WP-6.1's ESLint step, WP-0.1 and WP-0.2. Baseline
   capture on the phone.
2. WP-1.1, WP-1.2, WP-4.1, WP-4.2. Small, high-value, low conflict.
3. WP-1.4, WP-1.5, WP-1.6. The chat screen work; do them serially, since all three edit
   `ChatScreen.tsx`.
4. WP-1.3 with WP-6.2, then feature 1 (instant open).
5. WP-2.1, WP-2.2, WP-2.3 in the protocol and manager layer; WP-2.4, WP-2.5 in parallel.
6. WP-3.1, WP-3.2, WP-3.3, each measured with the latency probe.
7. Remaining Phase 4 rows, WP-1.7, WP-6.3 to WP-6.5, then Phase 5 features with the owner's choice.

Re-capture the WP-0.1 measurements after steps 2, 3 and 4 and record them in a release note.

## What this review did not cover

- No device, emulator or gateway was used. Frame times, memory, cold start and battery are unknown.
- The vendored protocol files, the Kotlin sharing module, the PC notification tooling and the
  smoke probes were not reviewed line by line.
- Gateway behaviour (snapshot size, accepted audio formats, upload limits) is inferred from
  `PROTOCOL_CONTRACT.md` and the client code, not observed.
- Installed dependency versions are newer than much public documentation. Where a step names a
  library option (expo-sqlite transactions, `Activity`, `reactCompiler`, list props), check the
  installed package before relying on it.
