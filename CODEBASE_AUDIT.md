# Codebase stability and simplification audit

> Dated evidence report. Installation and phone-availability statements describe their checkpoint. See [current status](docs/STATUS.md) and [release records](docs/releases/README.md) for later work.

Started 16 November 2026; remediation continues 17 November (Australia/Sydney).

The owner requested a thorough independent GPT-6.1 Sol audit at extra-high effort, the smallest
behavior-preserving cleanup, separate patch review/remediation, then the next voice refinement batch.
The auditor inspected requirements/evidence, native screens/helpers, the full first-party state
manager/reducer and protocol client, preferences, notifications and PC hook, build/test scripts,
principal smoke probes and relevant vendored contracts. It did not line-audit every generated field
or every vendored implementation. No new P0/P1 was identified; that is not a guarantee of no defects.
No secret-file reads, gateway/device actions, installations or subagents were used by the auditor.

## Confirmed corrections

These three P2 findings are bug fixes restoring intended behavior, rather than neutral refactors:

| ID | Finding | Small correction |
|---|---|---|
| A1 | A rejected Steer without explicit delivery evidence resolves, so Chat clears the editable draft. | Keep the draft and explain uncertainty; only fall back to an ordinary durable send when `delivered:false` is explicit. |
| A2 | `session.info` updates leave `snapshot.info` model/reasoning stale, and Voice prefers that snapshot. | Merge fresh metadata while preserving omitted fields and the established snapshot/event fences. |
| A3 | Draft/cache write failures update `state.error`, but Chat does not subscribe to or show it. | Show the existing local-save warning in Chat, including during the quiet connection grace. |

All durability, immutable credential pairing, endpoint isolation, session aliases, queue order/barriers,
replay deduplication and transcript-recovery safeguards stay in place. No broad manager rewrite or
vendored source change was justified.

## Behavior-neutral cleanup selected

- Remove the unused Milestone 3 foundation stub and uncalled manager methods.
- Remove ignored notification visibility arguments; retain visibility checks inside serialized work.
- Remove redundant render-time activity compaction; retain incremental compaction and cache migration.
- Remove compiler-confirmed unused imports/bindings.
- Qualify historical documentation status and provide an explicit offline aggregate test command.
- Ignore generated Python bytecode caches rather than treating them as project source.

## Dependency audit boundary

A registry audit found three moderate package reports tracing to **one** minimatch issue through
Expo fingerprint build tooling, with no high/critical reports. Installed minimatch is 10.2.6;
the advisory fixes the issue in 11.0.1. Automatic npm remediation proposed downgrading Expo 58 to 52.
That incompatible migration and an unverified major dependency override are outside this minimal
cleanup. The dependency tree is retained and this remains a documented limitation, not a claim of
zero advisories. [Maintainer advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## Evidence and status

The pre-change 145-file source snapshot, hashes, previous installed APK and baseline test logs are
under ignored `.artifacts/stability-20261116/`. Baseline types, protocol/state/helper/preferences/
voice tests and vendor drift passed. There is no Git HEAD; copied snapshots are the review baseline.
Cleanup is implemented and independently reviewed. A separate GPT-6.1 Sol/xhigh reviewer examined
the actual patch/context/tests with zero tools and returned clear after the final contract-shaped
Steer fixture correction. Main ran the offline aggregate: **196 tests passed**, plus workspace
types; the final Steer fixture's 11 focused cases also passed. The storage warning has source
review rather than a native render test. Source hashes and review packets are recorded alongside
the baseline. No gateway or device work was needed for this phase.

The next voice batch starts only after this cleanup checkpoint. No phone tests or overnight
installation are part of this task; the owner will install the final APK in the morning.

## Follow-up compatibility and voice verification

Exercising the actual Markdown parser exposed another inherited assumption: the root override
forced linkify-it 6.1.0 onto markdown-it 14.3.3, which declares the compatible 5.0.2 line. Both CJS
and ESM constructor checks failed with a non-constructor error. Removing that override and updating
the dependency tree restored the declared compatible version. The existing Markdown parser version
is unchanged, and the app now declares its direct speech-parser dependency and official development
types. A real-parser regression is included; no mock hides initialization. Lockfile validation passes.

The voice refinement uses bounded lazy parts, pause/resume/replay/rewind/speed controls and an
accessible recording indicator. Main's source checks and mocked native-boundary tests found and
remediated initial buffering/pause confusion, late seek callbacks, synchronous listener registration,
resource teardown failures and a delayed Pause event arriving after Resume. Independent Sol/xhigh
review cleared the repaired playback source, native adapter/tests and reduced-motion presentation
delta. Main's final **222 offline tests**, workspace types and protocol drift check pass.

A real gateway synthesis check formatted a synthetic reply into 5,322 spoken characters across
three bounded requests (1,992/1,964/1,364 characters). All three returned HTTP 200 and passed a
one-second PCM decode check. Its first harness attempt incorrectly treated the decoder's intentional early pipe close
as an audio failure; decoding from a temporary file fixed the harness, with failed evidence kept.
This proves the tested HTTP/media path, not phone playback or hearing quality.

Phone layout, real audio routing/interruptions and microphone behavior remain owner acceptance.
The final APK candidate and integrity checks are recorded in PC_SETUP.md. Dependency audit still
reports the same one transitive moderate issue described above, with no high/critical reports.
