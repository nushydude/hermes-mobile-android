# ADR 0002: Use and verify the canonical gateway protocol

- **Status:** Accepted
- **Decision date:** 15 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The internal Hermes gateway protocol can change independently of this app. The initial protocol
section of the plan was source research, and the owner's requirement was to verify the running
gateway before implementing the app.

## Decision

Vendor the relevant Hermes shared TypeScript contract and transport modules, retaining their license,
and build a transport-independent canonical session layer around them. Check for session authority
and advertised capabilities, use the verified RPC shapes, and decline unsupported desktop bridges
with 4404 or unknown server requests with -32601. Approvals are events followed by response RPCs.
Compare vendored files after a Hermes update and rerun the attended live smoke procedure before
assuming compatibility. Never modify the Hermes source checkout to patch the app.

## Alternatives

A separate hand-translated protocol and assumptions based only on source would increase drift risk.
The Webapp and legacy APIs do not replace canonical shared-session handling.

## Consequences

The app must handle request correlation, revision/generation fences, event offsets and evolving
payloads. The 15 November smoke found that rename's 4001 was a revision conflict caused by a stale
client revision; it was repaired in the smoke client with the documented retry. Not every possible
gateway feature has been exercised. Existing known bounds, including session-list limits and steer
ambiguity, must remain visible to future changes.

## Evidence

The repaired real-gateway exercise, Desktop handoff, approvals, remaining limits and exact differences
are in [PROTOCOL_CONTRACT.md](../../PROTOCOL_CONTRACT.md). See the
[protocol package](../../packages/hermes-protocol/README.md) and [smoke instructions](../../tools/smoke/README.md).
