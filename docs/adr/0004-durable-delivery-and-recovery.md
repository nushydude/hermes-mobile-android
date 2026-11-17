# ADR 0004: Persist drafts and outbox by gateway origin

- **Status:** Accepted
- **Decision date:** 15–16 November 2026; refined through 17 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

Phone connectivity can be interrupted while Desktop and mobile both view a session. A lost
acknowledgment must not cause a prompt to be silently lost or submitted twice. Cached history should
be available without treating stale state as authoritative.

## Decision

Keep the connection/session manager outside screen navigation. Store drafts, snapshots and the
outbox in SQLite scoped to the HTTPS gateway origin. Persist a submission and its stable ID before
network submission, and reuse that ID after ambiguous delivery. Use per-session sequence and replay
epoch to catch up; rebuild from the authoritative snapshot on a replay gap. Reconcile aliases and
retain recoverable drafts, image attachments and accepted text rather than discarding ambiguity.

Keep a bounded set of recently opened subscriptions and replaceable idle history; protect running
sessions, requests and local work. Queue controls apply only to genuinely queued admissions;
unknown delivery has an explicit recovery path. Current inventory search covers the loaded sessions.

## Alternatives

An in-memory-only composer would lose work on process death. Retrying an ambiguous submission with a
new ID could duplicate work. Treating every pending admission as queued misrepresented running turns.

## Consequences

Local state is ordinary app SQLite, not a claim of end-to-end encrypted history. A server snapshot
wins for remote state, while locally recoverable work is retained separately. Changing gateway origin
is blocked while unresolved drafts or pending messages need attention. Search is not a full-history
index; the observed list endpoint caps each inventory call at 200 rows.

## Evidence

[PROTOCOL_CONTRACT.md](../../PROTOCOL_CONTRACT.md) records replay, queue and inventory observations;
[the client](../../packages/hermes-protocol/src/client.ts) and [app manager](../../app/src/state/index.ts)
contain the implementation. Host recovery tests do not replace phone network-loss acceptance.
