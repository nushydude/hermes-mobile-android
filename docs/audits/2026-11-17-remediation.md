# Source audit remediation

Date: 17 November 2026. App candidate: **0.3.1 (8)**.

The owner authorized fixing all eight findings from the
[source audit](2026-11-17-source-audit.md), followed by small behavior-preserving
simplifications, independent GPT-6.1 Sol/xhigh review and an APK build.

## Repairs

| Finding | Result | Regression evidence |
| --- | --- | --- |
| Late deletion cleanup crosses endpoints | Recheck client ownership after detach and persistence; retain local recovery data created during same-endpoint deletion. | Delayed detach with a new origin/image draft and same-origin recovery. |
| Queued Edit overwrites a draft | Confirm before replacing different nonempty text; capture draft version and endpoint so late confirmation cannot overwrite newer work. | Draft ABA/version changes, valid replacement and endpoint change. |
| Running refresh loses reply prefix | Refresh replays from the delivered cursor; first joins and changed epochs still reconstruct. | Actual client and reducer, repeated refresh, overlaps, new generation and replay gaps. |
| Replay failure abandons acquisition | Fence the failed socket synchronously and retire its subscriptions before dropping ownership. | Error, timeout, malformed replay, resolved aliases and delayed native socket close. |
| Secure input has no Cancel | Add request-owned cancellation and Android back handling; clear typed secrets on request changes and reject stale input/actions. | Supersession, cancellation, late abort/Submit/Cancel and a successful replacement request. |
| Fixed-title probe ownership | Generate unique UUID titles and archive only the ID returned for that fixture; remove title-based recovery/cleanup. | Synthetic fixture uniqueness, existing-label isolation and returned-ID cleanup. |
| Completed stream retention | Retire completed-turn text while keeping bounded completion identities and active overlap checking. | 520 completed turns, reconnect/completed refresh, next generation and exact IDs containing colons. |
| Recovered storage warning | Successful draft/full checkpoints clear only owned warnings covered by their revision and endpoint. | Draft retry, durable Send, full image checkpoint, newer failures and unrelated errors. |

The new protocol regressions are in
[audit-regressions.test.ts](../../packages/hermes-protocol/test/audit-regressions.test.ts);
state regressions are in [manager.test.ts](../../app/src/state/manager.test.ts).

## Narrow simplifications

- One preference database/table accessor, preserving each preference's validation,
  state and subscriptions.
- One secure UUID implementation shared by the app and protocol adapter.
- One tested host credential parser/reader instead of thirteen copies. Literal
  syntax and generic errors remain; empty duplicate assignments are rejected.
- Explicit app client identity sourced from app version metadata. SDK callers
  keep their existing default unless they provide an identity.
- A shared fake-gateway test fixture rather than duplicated protocol harnesses.
- One offline aggregate including incoming-share plugin and fixture-ownership
  checks; CI no longer needs a duplicate plugin step.

No dependency migration, broad chat/voice rewrite, new service/account or signing
change was introduced. Submission identities, durable checkpoints, endpoint and
alias fences, selected model/reasoning and exact voice correlation remain.

## Review and checks

Main ran **328 offline checks**: 48 protocol, 111 state, 23 Node app/helper,
115 preference/component/notification, 24 Node tooling/plugin and seven Python.
Workspace types and strict unused checks for app/protocol passed. Verbatim vendor
drift and source credential-pattern checks passed.

Independent GPT-6.1 Sol/xhigh reviewed the actual implementation and tests. Its
initial review found a remaining warning after successful full checkpoints. That
finding was repaired, regression-tested and cleared in the repair review. The
shared test-helper extraction also cleared review. No review blockers remain.
Review is distinct from main's test execution.

The source snapshot is recorded locally as `candidate4.json` with per-file SHA256
values for 183 source, test, configuration and tooling files. It identifies a
working-tree candidate based on `8d509633857594d82431528d374cf0cfae645c97`; it is
not a claim that the base commit alone contains these fixes.

APK identity and packaging checks are in the [0.3.1 release record](../releases/0.3.1.md).

## Remaining acceptance

No installation, phone interaction or live gateway probe was performed for this
batch. Owner checks remain for queued-edit confirmation, secure Cancel/back,
stream refresh/notification approval, draft recovery and existing voice/share
flows. The source-only titled-create observation was not promoted to a new live
protocol claim. Existing moderate tooling advisories and production-signing
limitations remain documented.
