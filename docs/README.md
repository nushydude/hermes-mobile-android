# Documentation map

Updated 17 November 2026 (Australia/Sydney). Last recorded installation: **0.3.0 (7)**.

## Read first

1. [Project overview](../README.md): capabilities and entry points.
2. [Current status](STATUS.md): shipped work, evidence and acceptance gaps.
3. [Execution plan](../PLAN.md): approved scope, machine rules and gates.
4. [Architecture](architecture.md) and [ADRs](adr/README.md): boundaries and accepted decisions.

## Build and operate

- [PC setup/runbook](../PC_SETUP.md): endpoint, provisioning, rotation, installation and rollback.
- [Development](development.md): tooling, source layout, native modules, signing and maintenance.
- [Verification](verification.md): offline, live-fixture and owner-phone checks.
- [Notifications](../NOTIFICATIONS.md): both delivery paths and limitations.
- [Protocol contract](../PROTOCOL_CONTRACT.md): observations and labelled source-only research.
- [Protocol package](../packages/hermes-protocol/README.md) and [smoke tools](../tools/smoke/README.md).
- [PC hook contract](../tools/notifications/HOOK_CONTRACT.md).

## Releases and historical evidence

- [Changelog](../CHANGELOG.md) and [release index](releases/README.md).
- [0.3.0 release record](releases/0.3.0.md): artifact, checks and remaining phone acceptance.
- [Dated setup history](history/PC_SETUP_HISTORY.md): original observations and installation journal.
- [Adversarial review](../ADVERSARIAL_REVIEW.md), [stability audit](../CODEBASE_AUDIT.md) and
  [performance audit](../PERFORMANCE_AUDIT.md): dated findings and measurement limits.

## Approved designs

- [Warm Forest](designs/warm-forest-v1/DESIGN.md).
- [Voice playback refinement](designs/voice-v2/DESIGN.md).
- [Hands-free and mobile polish](designs/handsfree-v1/DESIGN.md).

Historical "not installed" or "phone disconnected" statements describe their checkpoint, not
current release status. Installation, host tests, live gateway checks and owner phone acceptance
are distinct evidence. Ignored `.artifacts/` and local orchestration ledgers provide extra evidence
on this PC; these guides preserve the portable facts and limitations.

When changing behaviour, update the relevant decision/design, status, changelog and verification
record. Keep credential values, private QR data, signing material and personal transcripts out of docs.
