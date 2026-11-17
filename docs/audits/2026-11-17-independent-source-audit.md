> Retained from the independent GPT-6.1 Sol/xhigh auditor. Main copied this report into repository documentation after validation. Scratch-file references below refer to ignored local audit evidence, not files available in a clean clone. No fixes are implemented by this report.

# Independent whole-codebase source audit — 17 November 2026

Candidate: `8d509633857594d82431528d374cf0cfae645c97` on `main`.

This audit used independent source inspection, not a supplied-diff-only review. It makes no production, test, configuration, dependency, gateway or phone changes. The auditor wrote only this ignored report. Main independently ran the baseline and created fixture-only reproductions in this same ignored audit directory. No secret files, private runtime configuration, chat artifacts, owner snapshots, phone actions or real gateway calls were used. No subagents were spawned by the auditor.

## Assessment

The existing design is substantially more careful than the compressed source initially suggests. Immutable credentials, endpoint epochs, serialized queue/checkpoint barriers, stable submission IDs, alias draft recovery, per-session replay cursors, native share staging, bounded provider workers and exact voice correlation all address concrete races. They should remain.

I found six actionable P2 issues and two P3 issues. Three P2 issues are protocol/state races independently reproduced by main with the actual maintained implementations and fake boundaries. The other P2 issues are direct UI/source behaviors or an upstream-contract-shaped tooling defect. No new P0/P1 is established. That statement is bounded by this audit and the untested native surfaces, not a claim that the program has no other defects.

The best next work is several small corrections with focused tests, followed by narrow duplication removal. A rewrite of the manager, protocol client or voice state machines would increase risk and is not justified by these findings.

## Prioritized findings

### F1 — P2: late deletion cleanup can erase another gateway's image draft

- **Anchors:** `app/src/state/index.ts:462` (`mutate`), `:449` (`forgetSession`).
- **Trigger:** Delete session `s` on gateway A. Let the delete RPC succeed but delay its detach RPC. Configure gateway B while there is no unresolved local A work; this is an allowed switch. On B, create a durable image draft under session ID `s`. Let A's old detach settle.
- **Current behavior:** `mutate` checks `this.client === client` before awaiting `detachSession`, then calls `forgetSession(s)` after the await without another endpoint/client check. `forgetSession` now operates on B's current state and checkpoint. It removes B's chat object, including its saved `draftAttachments`, and persists the removal to B's cache.
- **Impact:** Cross-origin local-state mutation and loss of uploaded draft-image references. Plain-text drafts are held separately and are not deleted by this specific path; do not overstate this as loss of every draft.
- **Evidence:** Main reproduced the transition with real `AppManager` and fake transport/storage, asserting B's durable cache contained the image path before the old continuation and omitted it afterward. Scratch: `manager-races.test.ts` / its audit logs.
- **Minimal remedy:** Capture the client/epoch for the mutation and revalidate immediately after detach and before any local cleanup or current-endpoint refresh. Preserve the existing server-side deletion and detach ownership rules.
- **Missing regression:** Endpoint switch during the post-delete detach await, including colliding session IDs and a newly saved image draft. Existing tests cover earlier RPC/inventory/alias continuations but miss this await.
- **Confidence:** High; reproduced.

### F2 — P2: refreshing an already-running session can erase its visible reply prefix

- **Anchors:** `packages/hermes-protocol/src/client.ts:318`, `:334`, `:347`, `:566`; `app/src/state/reducer.ts:43`; `app/src/state/index.ts:274` and `:472`.
- **Trigger:** Open a session, receive `message.start` and a delta `Hello`, then call `refreshSession` while the same execution generation is still running. This is a real path used to refresh authority before notification approval actions. The running snapshot is followed by replay from sequence zero, including the already-observed start and delta.
- **Current behavior:** The resume snapshot preserves the current running UI stream. `finishOpen` resets the protocol cursor to zero and delivers the replayed `message.start`, which clears reducer `liveText`/activity. However, the protocol's existing segment text remains and suppresses the repeated `Hello` delta as a duplicate. A new delta at offset 5 containing ` world` is then displayed by itself.
- **Impact:** An apparently intact live reply temporarily loses its already-read prefix until authoritative completion arrives. The app's snapshot cutoff deliberately allows start/delta recovery for a running snapshot and therefore does not hide the defect.
- **Evidence:** Main used the real `CanonicalClient` and actual `snapshotChat`/`reduceEvent`: `Hello` before refresh, empty text immediately afterward, then only ` world`. Scratch: `refresh-replay.test.ts` and `refresh-replay.log`.
- **Minimal remedy:** Make replay and UI reconstruction agree: either replay an entire current stream with appropriately reset active segment state, or keep the already-projected stream and skip replayed starts/known prefixes consistently. Do not remove offset/sequence validation or indiscriminately suppress the initial join replay.
- **Missing regression:** Refresh of an already-open running session, with replayed start plus overlap, subsequent fresh suffix, and tool/reasoning activity. Existing tests separately cover fresh snapshots and first joins but not this combination.
- **Confidence:** High; reproduced.

### F3 — P2: a failed initial replay abandons an acquired subscription and its event fences

- **Anchors:** `packages/hermes-protocol/src/client.ts:334`, `:358`, `:366`, `:370`, `:540`.
- **Trigger:** An initial open successfully acquires a running resume snapshot, then the following `session.events.since` call fails, times out or produces an invalid response.
- **Current behavior:** `finishOpen` has already applied the snapshot and acquired the server subscription. Its failure handler deletes a newly created session from the client map, without releasing that known acquisition or closing the socket. A later `detachSession` sees no local entry and returns. Incoming scoped events are still forwarded, but now take the no-session branch and bypass the client's cursor/segment deduplication.
- **Impact:** An unowned live subscription can outlive the failed open; duplicate deltas can be delivered, the session is absent from reconnect recovery, and later detach cannot release it through the usual path.
- **Evidence:** Main's actual-client fixture returned a successful running resume, then an RPC error for replay. `openSession` rejected; `getSession` was undefined; no detach was sent; the socket remained ready; two identical sequence-one deltas were both delivered. Scratch protocol cases are recorded in this directory.
- **Minimal remedy:** Explicitly unwind a successful acquisition on failure. Release the exact returned subscription on its acquisition socket; close the socket if release/resume outcome is ambiguous. Reuse existing ownership machinery rather than adding a second detach policy. Preserve the original error and guard aliases/cancelled opens.
- **Missing regression:** Failures after successful initial resume but before `finishOpen` completes, including replay error/malformed/timeout, an alias-resolved owner, and release failure.
- **Confidence:** High; reproduced.

### F4 — P2: queued Edit overwrites an existing saved composer draft

- **Anchors:** `app/src/screens/ChatScreen.tsx:1041`; `app/src/state/index.ts:412`.
- **Trigger:** Type an unsent draft while another prompt is queued, then tap Edit for that queued prompt.
- **Current behavior:** Edit directly calls `setDraft(id, text(q))`, replacing and checkpointing the existing composer text. No alternative copy, merge, confirmation or undo is provided.
- **Impact:** One ordinary UI action destroys a previously saved draft. The quote/share flows already preserve existing draft text, so this is an inconsistent preservation boundary.
- **Evidence:** Direct UI handler and real manager persistence semantics; main also confirmed the durable replacement with a fixture. This is not a rendered Android test.
- **Minimal remedy:** If the composer is nonempty and different, preserve it or request explicit replacement confirmation before placing the queued text in the editor. Empty/same-text cases can remain immediate. Do not cancel/replace the remote queued admission merely by opening the editor.
- **Missing regression:** Nonempty draft plus queued Edit, including cancellation, unchanged text and offline persistence. A focused behavior helper or actual screen interaction is preferable to a snapshot test.
- **Confidence:** High; source and manager behavior established.

### F5 — P2: secure-input UI has no user cancellation path

- **Anchors:** `app/App.tsx:55` through the secure Submit handler at `:87`; `app/src/state/index.ts:481`; request rejection ownership in `makeClient` at `:270`.
- **Trigger:** A legitimate `sudo` or `secret` server request opens the secure-input modal, and the owner wants to decline it or return to chat.
- **Current behavior:** The modal has only an input and Submit. It has no Cancel action or Android `onRequestClose`. The manager exposes only `answerSecret`, although it already retains the request's reject function. Server withdrawal/disconnect cancels correctly, but local refusal is unavailable.
- **Impact:** The owner cannot dismiss the blocking sheet without sending some value or waiting for external cancellation. This conflicts with the documented explicit secure-input cancellation behavior. Submitting an empty string is an actual response, not a cancellation substitute.
- **Evidence:** Direct complete UI/manager source inspection. No Android interaction or claim about exact hardware-back animation is made.
- **Minimal remedy:** Add a manager cancellation method that clears the owned pending request and rejects it, then expose accessible Cancel and route `onRequestClose` to it. Clear the typed secret on cancellation as is already done on request changes. Keep generation/abort ownership intact.
- **Missing regression:** User decline, late abort after decline, already-aborted input, and a newer request superseding an older one. A small rendered interaction test or manual phone acceptance should establish the modal affordance.
- **Confidence:** High for missing capability; native back behavior remains device acceptance.

### F6 — P2: fixed-title live probes can resume and mutate a pre-existing session

- **Anchors:** `tools/smoke/reasoning-picker.mjs:19`, `:21`, `:23`; `tools/smoke/voice-latency.mjs:47`.
- **Trigger:** A gateway already contains a session with the fixed fixture title, including an archived ordinary session. This naturally happens after the first probe run.
- **Current behavior:** Both scripts treat titled `session.create` as an unconditional fresh creation. The current canonical authority instead first resolves an existing title and resumes it. Reasoning also archives title matches before it has proved ownership, then makes the same titled create call. Latency can submit a prompt to that pre-existing session and archive it.
- **Impact:** The claim that each run touches only a fresh owned fixture is not guaranteed. Repeated runs can reuse old context, and a matching owner chat could be submitted to or mutated. This is a tooling correctness/ownership issue, not a request to exercise the live gateway now.
- **Source evidence:** Read-only inspection of current upstream source: `gateway/session_controls.py:495`–`:508` resolves the title before staging a new session and `:546` returns resume; `gateway/session_local_title.py:12` delegates title resolution; `hermes_state_titles.py:244`–`:264` explicitly returns archived rows for ordinary titles, with special retirement behavior only for Bot Chat. The earlier historical duplicate-title **rename** observation does not imply create-with-title fails: the initial failure hypothesis was rejected after checking this distinction.
- **Minimal remedy:** Use a new UUID title for every genuinely new fixture. Recover interrupted probe work only from durable owned-fixture IDs/evidence produced by that run, not a title-only search. Keep explicit cleanup and sanitized evidence.
- **Missing regression:** Fake canonical create that resolves an existing title; assert that distinct probe runs use distinct titles and cleanup targets only recorded owned IDs. No production credentials/provider calls are needed.
- **Confidence:** High; current source contract established. No new live run was performed.

### F7 — P3: completed replies remain duplicated in protocol segment memory

- **Anchors:** `packages/hermes-protocol/src/client.ts:66`, `:561`, `:566`, `:589`–`:590`; the only bulk clear at `:457` is on rebuild.
- **Trigger:** Keep a session subscribed across many completed, sizable replies.
- **Current behavior:** `message.complete` retires missing-prefix mode but keeps the full text of all previously assembled segments. The map evicts only when a later delta takes it above 512 entries. Thus completed reply text remains in protocol memory in addition to app history/cache; idle-history trimming does not trim this map while the protocol subscription remains protected/recent.
- **Evidence:** Main generated 520 completed turns of 1,000 characters each through the actual client. It retained 512 segment entries and 512,000 characters. These are logical retained characters, not measured Pixel heap bytes, a leak without any cap, or a frame-time claim. More than one segment per turn changes the count, not the full-text retention property.
- **Minimal remedy:** After confirming terminal/replay ordering, discard terminal-turn segment buffers when completion makes the canonical final reply authoritative; retain buffers for active/recovering streams. Sequence cursors must continue rejecting old frames. Add reconnect-after-complete and next-turn tests before pruning. Do not replace overlap text with hashes without considering partial overlap validation.
- **Confidence:** High for retention; the exact safe pruning boundary merits a narrow regression test before implementation.

### F8 — P3: local-save warnings persist after a successful retry

- **Anchors:** `app/src/state/index.ts:113`, `:412`; visible rendering at `app/src/screens/ChatScreen.tsx:879`.
- **Trigger:** A draft checkpoint fails once, then storage recovers and a subsequent edit is saved successfully.
- **Current behavior:** Failure sets `state.error = 'Could not save your draft.'`; successful later checkpoints do not clear that warning. It stays visible until another operation such as connection configuration replaces the general error field.
- **Impact:** The UI continues telling the owner that a now-durable draft could not be saved, obscuring whether current work is safe.
- **Evidence:** Main's real-manager fixture failed one write, then saved a new edit successfully and asserted both the persisted latest text and the stale warning. No native render was needed to establish the state defect.
- **Minimal remedy:** Track storage warning ownership/revision and clear only the matching warning after a sufficiently recent successful checkpoint, or provide a clear retry/status affordance. Do not blindly clear unrelated connection/recovery errors on any successful write.
- **Missing regression:** Fail→success, fail→stale-success→new-failure ordering, and unrelated errors surviving a successful draft save.
- **Confidence:** High; reproduced.

## Low-risk simplification shortlist

These are cleanup opportunities, not further confirmed functional bugs. Address them only after the correctness patches, in independent small batches.

1. **One credential-assignment parser for host tools.** The exact `.env` assignment regex, optional matching quote removal, duplicate rejection and nonempty/`file:` rejection are repeated in thirteen provisioning/QR/live-probe locations. `tools/config.mjs` already centralizes origin/home configuration. Add a pure parser plus a narrow private reader, generic errors and dummy-fixture tests; preserve provisioning's existing-entry rule, QR's TTY gate, read-only probe refusal and sanitized failure handling. Do not broaden `.env` syntax accidentally or read live secrets while testing.
2. **One preferences database accessor.** `app/src/preferences.ts:4` and `app/src/modelFavourites.ts:5` independently open `hermes-preferences.db` and create the identical table at import. Share the small DB/table/key read-write primitive, retaining separate preference types, validation, in-memory snapshots and subscriptions. A generic application store is unnecessary.
3. **One secure UUID implementation.** `app/src/state/index.ts:24` duplicates the RFC4122 bit setting/formatting in the locally authored `packages/hermes-protocol/src/vendor/session-http-mutations.ts:3` adapter. A shared exported first-party helper can remove duplication while keeping cryptographic randomness and every durable submission/request identity. The adapter is intentionally excluded from verbatim vendor sync; do not edit the seven canonical vendor modules to achieve this.
4. **Format dense lifecycle helpers in touched files.** `voiceController.ts`, `voicePlayback.ts`, `ReasoningPicker.tsx`, `IncomingShareSheet.tsx` and manager methods are highly compressed. Formatting and a few named transition/checkpoint helpers can expose ownership boundaries, but should be a separate behavior-neutral commit after fixes. A broad file split by line count is not itself a quality improvement.
5. **Keep package scripts honest and small.** `test:host` excludes the two incoming-share config-plugin checks; CI/doc commands add them separately. A clearly named aggregate or including those checks in the aggregate can reduce a human omission. JVM/native checks must remain a separately described prerequisite-bound step. Do not silently add live probes to any host aggregate.
6. **Version metadata honesty.** `CanonicalClient.createSession` at `client.ts:291` advertises `hermes-mobile` version `0.1.0` even though the app is `0.3.0`. If that field means the app build, pass the version explicitly; if it intentionally means protocol-adapter version, name/document it accordingly. No current functional failure is proved from this metadata.

## Optional structural work, only when the area next changes

- **A testable share-import coordinator** would be useful because `IncomingShareSheet.add` currently owns destination selection, file conversion/copying, upload, navigation checks, checkpoint identity and native-source cleanup in one UI callback. The boundary should accept native/file/upload/checkpoint adapters and immutable scope, returning review/import results. Keep the exact checkpoint-before-discard and cancellation fences. This is justified by an untested side-effect boundary, not by component length.
- **A recorder/reply-watch adapter beside `voicePlaybackNative`** would make actual `VoiceSheet` composition testable: permission, late prepare, native recorder URI/cleanup, meter freshness, correlation registration and manual/automatic timeout choices currently bridge otherwise well-tested pure classes inside React hooks. Do not merge the independently useful capture, playback and correlation state machines.
- **Typed ingress projections** for session rows, prompts and queue status would reduce repeated `Record<string, any>`/shape probing. Prefer validated projections at network/cache boundaries using the generated contract as context, rather than a sweeping `any` replacement or hand-written parallel protocol.
- **Narrow storage planning helpers** can eventually separate pure cache merge/migration decisions from SQLite/secure-credential commit steps. Preserve transaction/order semantics; the current queue/epoch model should not be generalized into an unrelated state library merely for style.

These broader items are not prerequisites for fixing F1–F8, and are less attractive than the concrete small patches.

## What should remain unchanged

- The one-versioned-origin/token SecureStore envelope, immutable client credential capture, candidate connection staging, no-redirect bearer transport, HTTPS/WSS validation and fresh single-use tickets.
- Stable random submission IDs; write-before-send and acknowledge-after-durable-checkpoint; exact-ID replay, ordinal FIFO across queued edits/submissions, uncertain-delivery recovery and conservative saved text. Never deduplicate by message text.
- Endpoint/client/navigation/operation-version fences, alias alternative drafts, origin-scoped cache and newer-draft/attachment rollback preservation. F1 needs an additional guard, not fewer guards.
- Canonical revision/generation conflict handling, request cancellation and exact returned subscription ownership. F2/F3 need coherent reconstruction/cleanup, not deletion of replay/offset machinery.
- The owner's deliberate OpenAI + saved custom/local mobile provider policy. `explicit_only` alone is known insufficient; provider hardcoding here is an accepted policy boundary, not stale dead code. Preserve disabled choices, provider identity, local favourites and honest requested/effective reasoning reporting.
- Foreground, half-duplex voice; normal durable submissions; no voice-specific model mutation; explicit Review first; exactly correlated final completion; pending ambiguity pauses; one-next-section prefetch and generation-owned native resources.
- Native share MIME/signature and byte validation, private no-backup inbox, staged writes, caller-only manifest commit, two bounded provider workers, whole-share deadline and late cleanup. The two permanently blocked workers limit is already explicit. Do not claim the workers are redundant because callers time out.
- Notification event filtering before queue work, serialized display/dedup, post-await visibility/origin rechecks, request/generation/safe-choice validation, private visibility, generic PC-hook payloads and bounded best-effort queue. The local/ntfy coverage limits are deliberate, not a reason to replace them with a new provider.
- Room constructor keep rule, RECORD_AUDIO manifest check, disabled cleartext/background microphone/background playback, remoteMessaging service type, direct Ionicons import, MarkdownIt/linkify compatibility and installed signing lineage. Do not apply the incompatible automatic Expo downgrade or an unverified major minimatch override.

## Test coverage and practical gaps

Main reports the frozen candidate passes workspace types, `test:host`, the two incoming-share plugin tests, separate strict unused checks and local checkout vendor drift. The dependency audit remains the documented three moderate reports around Expo fingerprint/minimatch, with zero high/critical reports; automatic remediation proposes an incompatible Expo 52 downgrade. Those baseline results are main's independent evidence, not a second auditor rerun. No live gateway/phone result is claimed by this audit.

The current host suite has substantial real behavioral coverage: fake-server transport/reconnect/aliases/detaches, durable manager writes/FIFO/rollback/origin changes, pure projection/search/filter helpers, controller/correlation/playback ownership, native-playback boundary mocks, notification adapter mocks and PC-hook fixtures. The native policy and bounded-provider JVM tests also test meaningful failure conditions rather than mirroring syntax.

However:

- There are no rendered `.tsx` screen interaction tests. Host tests of `chatActions`/`FollowLatest` do not prove the actual queued Edit, secure modal, search UI, TextInput selection, keyboard, modal stacking or scroll wiring.
- `manager.test.ts` replaces the canonical client. The protocol tests separately exercise the real client. F2 demonstrates why a few cross-layer protocol→actual reducer/manager scenarios are necessary despite both suites passing independently.
- Voice classes and playback boundary are tested, but actual `VoiceSheet` recorder/hook/correlation integration is not rendered end to end. Meter acoustics, routing, headsets and Android lifecycle remain phone acceptance.
- `IncomingShareSheet` has no direct coordinator/render test. Kotlin tests cover policy and bounded worker behavior, not the full Expo module's Android intent grants, currentActivity/OnNewIntent behavior, manifest persistence and JS import/discard flow together.
- CI runs host and plugin checks on two operating systems, not Android build/JVM/native lifecycle acceptance. This is clearly documented; it should not be represented as a complete native release gate.
- No file watcher, gateway restart, background-delivery guarantee, network-loss phone matrix, signing-key backup or production-signing process is established by the current offline checks.

Prioritize focused boundary regressions for the demonstrated defects over another blanket suite expansion or superficial component snapshots.

## Proposed small execution batches

1. **Endpoint-local deletion cleanup:** F1 plus a real-manager delayed-detach/new-origin-image-draft regression. Independently review the final guard placement. Run affected state tests and types.
2. **Protocol recovery ownership:** F2/F3 in small separable patches, with actual-client→actual-reducer tests for refresh reconstruction and exact-subscription failure unwind. Include alias, reconnect and detach existing regressions. Consider F7 terminal pruning only after correctness is stable, as its own measured change.
3. **Draft and secure-request affordances:** F4/F5; add meaningful helper/manager cancellation checks and one small UI interaction or explicit owner acceptance item. Keep request rejection distinct from submitting an empty value.
4. **Probe ownership:** F6; UUID titles and owned-ID cleanup with dummy fixtures. Centralize credential parsing only in a separate cleanup patch, preserving existing syntax and no-output rules. Do not execute live probes solely to validate their refactor.
5. **Warning lifecycle and narrow cleanup:** F8 with operation-owned success/failure tests, then DB accessor/UUID deduplication in separate reviewable commits. Keep formatting separate from semantic corrections.

An APK build/install, live gateway exercise and public publication are separate owner-authorized actions. This report requests no such action and implements none.

## Audit coverage

The following maintained implementations were read in full (including dense helpers), rather than only located by search:

- **Governing/evidence:** full `PLAN.md`, current `PROTOCOL_CONTRACT.md`, `docs/STATUS.md`, `docs/architecture.md`, all accepted ADRs 0001–0011, `CODEBASE_AUDIT.md`, `ADVERSARIAL_REVIEW.md`, `PERFORMANCE_AUDIT.md`; also README, security/contributor/development/verification guidance and the notification hook contract.
- **App/bootstrap/UI:** `app/App.tsx`, `app/index.ts`, `app/polyfills.ts`, `app/src/types.ts`, `theme.ts`; full Setup/Home/Chat screens; `UI`, `Sheet`, `MessageInput`, `MessageActionSheet`, `ModelPicker`, `ReasoningPicker`, `VoiceSheet`.
- **State:** full `state/index.ts`, `reducer.ts`, `imageReads.ts`, `voiceHttp.ts`; `preferences.ts`, `modelFavourites.ts`.
- **Helpers:** full `activityVisibility`, `chatActions`, `connectionGrace`, `useConnectionGrace`, `followLatest`, `haptics`, `images`, `modelFavouriteCore`, `monitorStatus`, `notificationPermission`, `pendingQueue`, `reasoningLevels`, `selections`, `slash`, `status`, `voiceActivity`, `voiceController`, `voiceCorrelation`, `voiceMeterBridge`, `voicePlayback`, `voicePlaybackNative`, `voiceText`.
- **Protocol:** full maintained `client.ts`, `globals.ts`, `initialize.ts`, `index.ts` and locally authored UUID adapter. The seven verbatim vendor files were interface/import/type context, not independent refactor targets; selected generated session/queue fields and event channel contracts were inspected, not every generated field.
- **Notifications:** full `notifications.ts`, `notificationCore.ts`, `notificationText.ts`; full PC hook Python implementation, config parser, prepare-runtime and start/autostart/subscription-QR tools.
- **Sharing:** full `IncomingShareSheet.tsx`, `nativeSharing.ts`, `HermesSharingModule.kt`, `SharePolicy.kt`, `BoundedWork.kt`; native package/build/module registration and manifest context; both native JVM test source files.
- **Build/tooling:** workspace/app/protocol package metadata and configs, app JSON, Metro resolver, all four app config plugins, CI workflow, full contract sync, host config/provisioning/setup-QR tools and all Android PowerShell tools.
- **Live smoke source only:** full main protocol probe/core, package/model/reasoning/voice-latency/audio/M4A probes, audio core and synthetic audio generator, live manager/rename/recovery/notification test sources. They were not executed.

Test inspection was targeted rather than a claim of line-auditing every assertion: both Vitest app configs, actual client fake-server harness and session/refresh/detach/replay tests, manager harness and durability/origin/alias/paging/sharing cases, voice/controller/native/playback cases, search/filter/notification test enumeration and coverage boundaries, config plugin tests and both full JVM files were inspected. Main supplied baseline pass evidence and independently reproduced findings; exact scratch reproduction artifacts are retained in this ignored directory.

External source reads were narrowly limited to current Hermes title-create/resolution/rename logic for F6. No configuration, credentials, runtime database, log or user transcript was read. Historical audit findings were not assumed still present: their repaired credential/queue/alias/transcript/steer/metadata/image/native resource guards were considered current requirements.

## Limitations and unverified hypotheses

- No Pixel frame-time, heap, flash-write, cold-start, battery, acoustic, keyboard, native grant or UI-layout measurement was made. Retention counts are algorithmic evidence only.
- Native image provider reads can occupy two workers indefinitely when interruption is ignored; this is the documented bounded limit and was not rediscovered as an unbounded thread defect.
- Imported image previews can be evicted while remote paths remain; this is deliberate recovery behavior.
- Large multi-photo base64 allocations, long live-Markdown parse cost and long-history scroll performance remain profiling candidates, not new confirmed regressions.
- Synchronous preference/notification database initialization can fail before the app's asynchronous startup error UI; no actual corruption/startup failure was induced, so this is a resilience follow-up, not a confirmed release crash.
- Hook live polling currently lacks an explicit fetch deadline; a Vitest test timeout does not cancel fetch. This is a small tooling hardening follow-up, not established notification delivery failure.
- Fixed-title duplicate-create failure was investigated and rejected as the wrong model of canonical create. F6 records the current existing-session resolution behavior instead.
- No recommendation is made to remove fences, stable UUIDs, durable checkpoints, exact correlation or secret/transport validation merely because the implementation is verbose.

The report is an audit and proposed next actions only. All production behavior remains the frozen candidate.
