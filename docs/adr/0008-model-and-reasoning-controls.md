# ADR 0008: Owner-scoped models and honest reasoning controls

- **Status:** Accepted
- **Decision date:** 16–17 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The owner requested lists instead of free-text workspace/model input, and saw Claude models despite
intending to use OpenAI plus configured local/custom providers on mobile. The gateway's definition of
`explicit_only` also includes certain other CLI logins. Reasoning choices can be clamped by a provider.

## Decision

Request the configured catalog with `explicit_only: true`, then apply the owner's mobile policy:
OpenAI/OpenAI Codex plus explicitly saved user-defined or local-runtime providers. Preserve provider
identity, disabled states and gateway-default choices. Workspace choices come from recent session
directories; selecting a model or workspace is explicit. Device-local model favourites reorder the
same allowed catalog and do not enable providers.

Present the eight verified Hermes reasoning policy values plus an explicit profile-default reset.
Show requested and effective values when reported, apply only on user action, and explain deferred
changes. A voice turn must not silently change the chosen model or reasoning.

## Alternatives

Free text permits unsupported or mistyped paths/models. Assuming `explicit_only` means the owner's
mobile provider list exposed unintended choices. Inventing a per-model reasoning enum from the
catalog's boolean capability would overstate what the gateway reports.

## Consequences

This is an owner-specific mobile filter, not a general definition of configured Hermes providers.
Individual OpenAI models still come from the provider's returned catalog. The gateway does not
forward a complete supported-effort list; displayed Hermes policy values may be clamped by routing.
Favourites are phone-local. The reasoning test did not prove provider execution for every model.

## Evidence

Real global and session-scoped model probes, source rationale, and the owned idle reasoning-mutation
smoke are in [PROTOCOL_CONTRACT.md](../../PROTOCOL_CONTRACT.md). The shared catalog policy is in
[selections.ts](../../app/src/components/selections.ts).
