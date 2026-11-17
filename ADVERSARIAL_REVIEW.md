# Independent adversarial review — 16 November 2026

> Dated evidence report. Installation and phone-availability statements describe their checkpoint. See [current status](docs/STATUS.md) and [release records](docs/releases/README.md) for later work.

Requested by the owner while phone testing is paused. The independent auditor ran with the
explicitly requested **GPT-6.1 Sol / High**, in a fresh context, with read-only source access and
fixture-only execution. It inspected the protocol, app state, native UI and build/provisioning
code. It had no access to production credentials, live gateway calls or device captures.

The initial audit confirmed **three P1 and six P2 findings**, with no P0. Main reproduced the
baseline findings using the actual TypeScript source with fake transport/native adapters.
Ignored evidence is under `.artifacts/audit/`; those fixtures contain dummy credentials only.

| Severity | Confirmed defect | Repair |
|---|---|---|
| P1 | A deleted retained session prevents every reconnect, including healthy chats. | Isolate structured `not_found`, forget its subscription and aliases; retain typed local recovery data. Explicit deletion also detaches and removes recent membership. |
| P1 | Changing setup can send the new token to the old origin; separate credential writes can tear. | One versioned SecureStore credential pair, immutable client credentials, quarantined candidate client, guarded activation. |
| P1 | A message queued during another origin's setup can be drained to that origin. | Serialized commit-time checks, origin-scoped cache and durable queue, captured endpoint context, stale continuation rejection, busy setup controls. |
| P2 | Older transcript replies arriving last can reorder messages. | Transcript request versions invalidate stale replies and snapshots invalidate earlier transcript requests. |
| P2 | Snapshot replacement retains an obsolete pagination cursor, skipping history. | Reset cursor with snapshot replacement; honor transcript reset responses. |
| P2 | A cold-start accepted message can duplicate authoritative history and be labeled waiting to send. | Recover admission receipts, label accepted/finished honestly, keep unmatched finished text under Chat settings rather than duplicate it in the transcript. No text-based identity guesses. |
| P2 | Late alias resolution steals navigation and strands drafts. | Shared serialized canonical resolution across public open, reconnect and queue drain; preserve newer navigation, all queued IDs/order, and conflicting drafts with copy/swap recovery. |
| P2 | An already-cancelled secure-input request opens a stuck sheet. | Reject an aborted signal before superseding or displaying any secure-input request. |
| P2 | Enabling activity still hides metadata-only projected tool history. | Render tool context/arguments and any saved body; retain the default-off presentation filter. |

The repair audit also caught incomplete offline alias recovery and completed saved copies blocking
connection setup. Those follow-ups were repaired within the corresponding findings. Completed
origin-scoped saved copies are settled and can remain safely cached when switching origins.
Accepted, failed or unsent local work still requires attention before changing origins.

An additional **P2** was confirmed during repair validation: after credentials are lost or invalid,
reconfiguring could overwrite an existing origin-scoped cache with empty initial state. Recovery
setup must restore that verified origin's cache and preserve unbound typed work before committing.
This brings the confirmed total to **three P1 and seven P2**, all repaired within the verified
scope. The final source review caught an additional retry variant involving identical chat
history; the repair and its regression tests received a clear follow-up verdict.

Credential migration assumes the existing legacy origin/token pair is consistent. An invalid
new-format pair fails closed and requires setup. This cannot retroactively prove an old torn pair
was valid. Origin scoping is a safety boundary, not a new multi-profile feature.

## Verification and remaining device work

Main executed the live app-manager probe with in-memory native adapters and real HTTPS/WSS through
Tailscale: outbox acceptance, authoritative transcript, second-viewer pending/reply, image upload
and exact readback passed. Only disposable own sessions were created and archived.

The new live recovery probe initially failed because the actual gateway returns **4001**, not
the fixture's 4004, for a deleted session's structured `not_found`. The corrected probe passed:
healthy reconnect, a new prompt after reconnect, and `prompt.receipt` reaching `terminal` without
resubmission. See `PROTOCOL_CONTRACT.md` for the observed contract and receipt limitation.

The phone remains disconnected at the owner's request. The latest repairs have not been installed
or tested on it. Rename Save, setting persistence after restart, recovery/settings layout and
the remaining Gate 3 phone/Desktop handoff and approval checks need the phone later. Milestone 4
remains open; no new milestone is authorized by this audit.

Final offline checks passed: 32 protocol, 51 state, 11 helper/reducer, 4 preferences/activity and
8 unchanged smoke-core tests. All 12 independent audit fixture scenarios also passed. The preview
APK built successfully, its signature verified, cleartext remained disabled, and scanning the
decompressed APK found zero matches for the deployment token. The APK has not been installed.

The independent repair verdict, candidate hashes and APK checks are recorded in
`.codex/orchestrator/adversarial-review.md`. Token usage
telemetry is unavailable; no team total is claimed.
