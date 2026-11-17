# ADR 0012: shared conversation controls and observed tasks

- Status: Accepted for the owner-test implementation; native production voice remains deferred
- Recorded: 18 November 2026

## Decision

Keep the canonical shared session as authority for all text and voice submissions. Presets atomically change only that session's enabled OpenAI-Codex model/reasoning policy, retaining confirmations and advanced controls. One foreground speech owner arbitrates typed readback and voice playback; exact durable submission correlation prevents foreign-turn speech. Type instead checkpoints into the existing draft without sending, with explicit recovery from save failure.

Project only stable observed child identities and explicit outcomes. A live-roster disappearance means Unknown. Parent-scoped transcript reads and specific interrupt requests use supported upstream RPCs. A separate bounded best-effort SQLite task cache may fail into memory without affecting chat. First terminal evidence survives cache races. Notifications deduplicate by origin, parent and child. No new executor or guarantee of detached admission is introduced.

## Reasons and consequences

This preserves Desktop context, approvals, existing outbox recovery and Home Dashboard isolation. Native speech-to-speech cannot ship until upstream supports idempotent canonical same-session exchanges and the existing included-credit allowance has an enforceable no-paid-fallback boundary. No direct database writes to Hermes, new plans, profile/MCP changes or custom Hermes fork are used. Existing file audio remains the fallback implementation; native audio focus, calls, routing, accessibility and performance still need owner acceptance.

See [release evidence](../releases/0.3.2.md), [execution record](../plans/conversational-experience-execution.md) and [native voice gate](../plans/conversational-phase3-gate.md).
