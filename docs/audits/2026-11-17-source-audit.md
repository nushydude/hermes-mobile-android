# Source audit: stability and simplification

Date: 17 November 2026, Australia/Sydney. Candidate:
`8d509633857594d82431528d374cf0cfae645c97` (app 0.3.0, build 7).

The owner requested an independent GPT-6.1 Sol audit at extra-high effort. This
report separates reproducible defects, source-level findings and optional cleanup.
It does not record implemented fixes or new approval of product features.

Follow-up: the owner subsequently authorized repairs; see the
[remediation record](2026-11-17-remediation.md) for implementation and review evidence.

The independent auditor reported **six P2 and two P3 findings**, with no new
P0/P1 established within the inspected scope. The [full independent report](2026-11-17-independent-source-audit.md)
includes its exact coverage, rejected hypotheses and detailed test gaps. Main
validated the consequential findings with source checks and isolated probes.

## Verification

Main ran the following against the unchanged candidate:

- Workspace type checks and strict unused-local/unused-parameter checks for the
  app and protocol package: passed.
- Host checks: 299 passed; incoming-share manifest plugin checks: two passed.
- Vendored protocol comparison against the local Hermes checkout: passed.
- Six isolated local reproduction/measurement cases using fake gateways and
  storage: passed while asserting the existing problematic behavior. These are
  audit evidence, not regression tests establishing correct behavior.
- Current npm audit: three moderate advisories in the Expo/fingerprint/minimatch
  dependency chain; no high or critical advisories reported. The suggested
  automated fix downgrades Expo incompatibly and should not be applied blindly.

No phone tests, real gateway calls, configuration changes, service restarts,
installation or source remediation were performed. UI findings below are based
on source, not a claimed reproduction on Android. The test cases and raw logs
remain in ignored local audit evidence.

## Correctness findings

### A1 — Old deletion cleanup can remove a new gateway's image draft (P2)

Location: [AppManager.mutate](../../app/src/state/index.ts#L462), followed by
[forgetSession](../../app/src/state/index.ts#L449).

The method checks client identity after the delete RPC, then awaits detachment
before calling `forgetSession` without checking identity again. If the endpoint
changes during that wait, cleanup operates on the current endpoint's state.

Main reproduced this sequence with fake clients: start deletion on gateway A;
hold its detach response; configure gateway B; save an image draft under the same
session ID; release A's response. B's chat and draft attachments disappear and
the next B cache checkpoint no longer contains the uploaded image reference.
Ordinary text drafts are stored separately and were not demonstrated lost by
this particular path.

Smallest remedy: retain the original client/endpoint identity across the entire
operation and revalidate after each asynchronous boundary before local cleanup.
Also decide how to retain recovery data created while a delete is in flight.
Test a delayed detach followed by an endpoint change and a new image draft.

### A2 — Queued-message Edit overwrites an existing composer draft (P2)

Location: [queued Edit action](../../app/src/screens/ChatScreen.tsx#L1041), calling
[setDraft](../../app/src/state/index.ts#L412).

The action directly replaces the saved composer text with the queued prompt.
There is no confirmation, separate edit buffer or retained alternative. Main
verified the state/storage consequence using the actual manager: the previously
saved draft is replaced and is no longer present in the draft map. The native
tap itself was not tested.

Smallest remedy: preserve a nonempty, different composer draft before opening a
queue edit, or ask explicitly before replacing it. A separate queue-edit buffer
is cleaner if it can reuse existing queued-edit recovery. Add a test covering a
nonempty composer, editing a queued item and cancellation without losing either.

### A3 — Refreshing a running session can erase its displayed stream (P2)

Locations: [refreshSession/finishOpen](../../packages/hermes-protocol/src/client.ts#L315),
[delta deduplication](../../packages/hermes-protocol/src/client.ts#L564),
[message.start reducer](../../app/src/state/reducer.ts#L43).

A fresh running snapshot preserves the app's live text. `finishOpen` then rewinds
the protocol sequence cursor and replays the active generation from zero without
resetting its existing segment cache. A replayed `message.start` clears the UI
stream, but the already-cached `message.delta` text is suppressed as a duplicate.
The manager's snapshot cutoff permits start/delta events for running snapshots,
so it does not prevent this sequence.

Main reproduced `Hello` becoming empty after refresh; the next delta displays
only ` world`. The authoritative completed message can restore the final text,
but the running display is incomplete. Notification approval validation is one
caller of this fresh-snapshot path.

Smallest remedy: give initial reconstruction and refresh consistent ownership of
the stream baseline and replay cursor. Do not reset a consumer while retaining
the deduplication baseline that suppresses its reconstruction. Test the real
client and reducer together, including running refresh, new generation, replay
gaps, duplicate deltas and completion.

### A4 — A replay failure after resume can abandon subscription ownership (P2)

Location: [finishOpen failure cleanup](../../packages/hermes-protocol/src/client.ts#L334).

On a first open, resume may succeed and acquire a subscription before the
follow-up replay request fails. The catch block deletes the local session entry
without releasing the acquired subscription or closing the socket. A later
`detachSession` finds nothing to detach. Events for the now-untracked session
take the generic event path without its sequence/offset protections.

Main reproduced a successful running resume followed by a replay RPC error:
the socket stays open, the session entry is absent and no detach RPC is issued.
Two identical sequence/delta events are then delivered twice to the consumer.

Smallest remedy: release the acquisition before dropping its ownership record,
or retire the connection when safe release is uncertain. Preserve the existing
detach-generation and alias protections. Add post-resume replay-error, timeout
and malformed-reply cases, not only failures before acquisition.

### A5 — Secure input has no local cancellation action (P2)

Locations: [secure-input Modal](../../app/App.tsx#L55) and
[answerSecret](../../app/src/state/index.ts#L481).

The modal offers Submit only. It has no Cancel action or Android
`onRequestClose`; the manager exposes completion but no user cancellation API.
A server abort or connection change can withdraw the request, but the user has
no explicit way to refuse it locally. Submitting an empty value is not an
appropriate cancellation mechanism.

Smallest remedy: reject the pending request through an explicit cancel method,
clear its UI state and connect that method to a visible cancel/close control and
Android back. Keep server cancellation and request replacement race-safe. Test
that cancellation resolves only that request and a late Submit cannot answer a
replacement request.

### A6 — Smoke fixtures assume a matching title means a newly owned session (P2)

Locations: [reasoning probe](../../tools/smoke/reasoning-picker.mjs#L18) and
[latency probe](../../tools/smoke/voice-latency.mjs#L47).

Both use a fixed title. The reasoning probe also archives matching rows before
creating its fixture. Current Hermes source resolves a titled create to an
existing session when one matches; ordinary archived titles remain resolvable.
Thus a titled `session.create` is not necessarily a fresh-session operation.

This was checked in the local upstream source (`gateway/session_controls.py`,
`hermes_state_titles.py`), not by running the probes against the real gateway.
Repeated latency runs may reuse history, affecting timing comparability. More
seriously, title matching alone does not prove ownership before archive,
reasoning mutation or prompt submission.

Smallest remedy: use a fresh UUID title for every new fixture. Resume interrupted
work only through an explicitly recorded owned session ID and validate that
record against the configured origin. Remove broad title-based cleanup. Test a
preexisting matching title and ensure it receives no mutations or prompts.

### A7 — Storage warnings remain after successful persistence (P3)

Location: [draft checkpoint failure handling](../../app/src/state/index.ts#L412).

Main reproduced a failed draft save followed by a successful save: the latest
draft is in storage, but `state.error` still says it could not be saved. Similar
sticky warning handling should be reviewed at cache checkpoint callers.

Smallest remedy: give storage warnings operation ownership/versioning so a later
successful checkpoint clears the corresponding warning without hiding an
unrelated error. Test failure, recovery, overlapping saves and unrelated errors.

## Performance and simplification

| Opportunity | Evidence and smallest useful change | Caution |
| --- | --- | --- |
| Retire completed stream segments (P3) | The protocol retains completed-turn text in its 512-entry segment map. Main measured 512,000 retained characters after 520 completed 1,000-character turns. Clear terminal-turn segments or keep only the active reconstruction window. | This is bounded retention, not a measured heap leak or phone benchmark. Preserve active-turn overlap checking and test replay/refresh together. |
| Share preference persistence | `preferences.ts` and `modelFavourites.ts` open the same database and initialize the same table separately. Share the database/table and narrow read/write helpers. | Keep distinct keys, validation and subscriptions; avoid a generic settings framework. |
| Centralize host credential parsing | Thirteen tools/tests repeat token-entry regex, unquoting and literal-value validation. Use one tested helper with generic errors. | Preserve QR terminal guards and never log values. Use synthetic fixtures, not actual credentials, in tests. |
| Clarify chat screen boundaries | ChatScreen combines rendering, media, message actions, Find/scroll, model controls and queue handling. Extract a few cohesive components/hooks after regression coverage exists. | A large rewrite would risk keyboard, scrolling and endpoint lifecycle behavior. File size alone is not a defect. |
| Consolidate secure UUID generation where appropriate | The manager and protocol have equivalent UUID generation responsibilities. A shared small helper can avoid drift. | Preserve cryptographic entropy, protocol injection points and durable submission identity. |
| Clarify client-version metadata | Session creation advertises `0.1.0`, while the app is `0.3.0` and the protocol package is `0.1.0`. Decide whether it identifies the SDK or app, then source it consistently. | No wire-protocol incompatibility was demonstrated. Do not mechanically replace unrelated package versions. |
| Make the host aggregate harder to omit | CI runs incoming-share plugin checks separately from `test:host`. Include them in a clearly named offline aggregate or retain an unmistakable documented command. | Keep JVM prerequisites separate and never introduce live probes into the offline aggregate. |

These changes should not be presented as a fix for slow model execution. No new
end-to-end latency measurement was performed in this audit.

When those areas next change, a testable share-import coordinator and a native
recorder/reply-watch adapter offer better boundaries than splitting files by line
count. They can protect checkpoint-before-discard and recorder/correlation
lifecycles without merging the existing state machines. Validated ingress
projections could also reduce repeated dynamic shape handling; a broad protocol
type rewrite is unnecessary.

## Recommended order

1. Add focused failing regression tests and repair draft preservation, delayed
   cleanup, stream refresh and subscription failure ownership.
2. Add secure-input cancellation and fix probe ownership. Validate the latter
   with fake fixtures before another explicitly scoped live smoke run.
3. Repair storage-warning recovery and prune completed stream retention with
   replay tests.
4. Consolidate preferences and tool credential parsing; consider small chat
   component extractions only after behavior is protected.

Keep the existing endpoint/epoch checks, durable submission UUIDs, write
checkpoints, alias reconciliation, exact voice reply correlation and bounded
native workers. Their complexity addresses real races. Do not refactor vendored
canonical files independently of upstream, force an Expo downgrade, change the
owner's model policy or alter signing as incidental cleanup.

## Coverage and remaining limits

The independent audit covered maintained protocol/state/UI code, voice helpers,
notifications, native sharing, preferences/model controls, host tooling,
prebuild/build configuration, CI and relevant tests/ADRs. Generated upstream
contract code was interface context rather than a refactor target.

The existing suites strongly exercise separate protocol, manager and helper
layers. The reproduced refresh problem demonstrates why a few integration tests
using the real client with the real state projection are also valuable. Native
dialog, gesture, focus, keyboard and scroll behavior still need targeted owner
acceptance or an appropriate component/device test layer. Passing host tests is
not evidence of Android interaction correctness.
