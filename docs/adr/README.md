# Architecture decision records

These records capture decisions already made while building Hermes Mobile. They were recorded
retrospectively on 17 November 2026; recording them does not create new owner approval or expand the
scope of a decision. [PLAN.md](../../PLAN.md) is the governing plan, including later owner-approved
follow-ups. When protocol research and the running gateway differ, the observed evidence in
[PROTOCOL_CONTRACT.md](../../PROTOCOL_CONTRACT.md) takes precedence. Source inspection, host tests,
gateway tests and owner phone acceptance are different kinds of evidence and are identified as such.

| ADR | Decision | Recorded | Status |
| --- | --- | --- | --- |
| [0001](0001-native-client-and-shared-sessions.md) | Native Android UI and shared sessions | 2026-11-17 | Accepted |
| [0002](0002-canonical-protocol.md) | Canonical gateway protocol and contract verification | 2026-11-17 | Accepted |
| [0003](0003-tailnet-transport-and-credentials.md) | Tailnet TLS and session-token provisioning | 2026-11-17 | Accepted |
| [0004](0004-durable-delivery-and-recovery.md) | Origin-scoped local state and durable delivery | 2026-11-17 | Accepted |
| [0005](0005-notifications.md) | Local alerts and best-effort PC notifications | 2026-11-17 | Accepted |
| [0006](0006-continuity-first-voice.md) | Continuity-first foreground voice | 2026-11-17 | Accepted |
| [0007](0007-warm-forest-presentation.md) | Warm Forest presentation and calm connection feedback | 2026-11-17 | Accepted |
| [0008](0008-model-and-reasoning-controls.md) | Owner-scoped models and honest reasoning controls | 2026-11-17 | Accepted |
| [0009](0009-android-incoming-shares.md) | Reviewable Android sharing and durable drafts | 2026-11-17 | Accepted |
| [0010](0010-android-packaging-and-signing.md) | Android packaging, compatibility and current signing lineage | 2026-11-17 | Accepted |
| [0011](0011-public-source-distribution.md) | Public reusable source and private deployment boundaries | 2026-11-17 | Accepted |
| [0012](0012-shared-conversation-controls-and-observed-tasks.md) | Shared controls, speech ownership and observed task boundaries | 2026-11-18 | Accepted for preview |

Use [the template](template.md) for future decisions. Do not rewrite a historical record to make
an old decision appear current: add a new record that names the superseded one and update this
index. Record proposed decisions as proposed until the owner approves them where approval is needed.
Operational status belongs in [PC_SETUP.md](../../PC_SETUP.md) and the current documentation index;
ADRs explain why a decision was made and its consequences.
