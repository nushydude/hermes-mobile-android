# Phase 3 native voice gate

Decision: evaluated and deferred. Native voice is not enabled or claimed implemented. Continue independent phases using the existing chained audio implementation.

Read-only investigation of clean installed Hermes source at `ea1d78596e7ddd51daf228311cb37e033fd2686c` found no supported way to idempotently append an external user/assistant speech exchange to the current canonical session. `hermes_state_mutations._import` skips existing session IDs; foreign import accepts opaque foreign-history identities; `prompt.submit` executes the agent. The existing GPT-Live path does not canonically store every spoken exchange. Direct database writes, delete/reimport, summaries and a custom Hermes fork do not satisfy the shared-session contract.

The authenticated native-voice status check reported `mode: chained`, `available: false`; no native API credential was configured. This does not establish that either native voice or the existing chained pipeline works on the phone. Remaining included-credit balance, expiry and an enforceable prohibition on paid fallback have not been verified. No API inference, billing change, new plan or purchased credits were used for this investigation.

Reopening requires a supported idempotent canonical same-session exchange commit and verified included-credit admission/reservation/hard stops, followed by explicit production acceptance. It must preserve desktop memory/tools, cancellation and cost boundaries. No provider, credential, Home Dashboard profile, MCP grant, scheduler, gateway or Tailscale configuration was changed.

Independent GPT-6.1 Sol / Extra High outcome review cleared this gate decision based on supplied source/status evidence, with zero tool calls. This is a deferred conditional phase, not a tested production voice feature.
