# ADR 0007: Warm Forest presentation and calm connection feedback

- **Status:** Accepted
- **Decision date:** 16 November 2026; revised through 17 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The owner asked for a friendly, polished phone experience rather than a dense technical interface,
and reviewed a visual design before authorizing implementation. Routine startup connection changes
and reasoning/tool output were distracting; approvals and failures still need to remain visible.

## Decision

Use the owner-approved Warm Forest visual direction with generous touch targets, clear action icons,
colours and system-respecting haptics. Start connection attempts immediately but suppress routine
connection notices during a ten-second grace period. Default to a clean chat; a device-local setting
reveals reasoning and tool activity. Requests requiring attention, errors and ordinary messages remain
visible. Preserve scroll intent when the user moves away from the latest message.

The initial single-line composer was superseded by the owner's 17 November request: it starts compact,
grows with wrapped text/newlines and scrolls after its height limit. Enter adds a newline; Send remains
explicit. Chat actions, loaded-message Find and loaded-inventory filters were later approved.

## Alternatives

Exposing every internal event by default makes the chat harder to read. Hiding actual approvals,
delivery errors or persistent connection failures would obscure decisions the owner needs to make.

## Consequences

The activity setting changes presentation, not gateway execution or approval handling. Search in chat
currently covers loaded visible messages, and session filters cover the loaded inventory. The current
palette is dark; system-following light/dark support remains planned rather than being claimed complete.

## Evidence

[Warm Forest design contract](../designs/warm-forest-v1/DESIGN.md), [PLAN.md](../../PLAN.md),
and [PC_SETUP.md](../../PC_SETUP.md) record the approved visuals and implementation checkpoints.
Phone selection, long-distance search navigation, accessibility and scrolling remain owner acceptance.
