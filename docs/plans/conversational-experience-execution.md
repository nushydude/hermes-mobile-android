# Conversational experience execution record

17 November 2026, Australia/Sydney. Owner authorized implementation with independent GPT-6.1 Sol / Extra High review and remediation after every phase. Owner subsequently authorized overnight commits/progression after review, stopping for consequential configuration changes or blockers.

## Phase 0 diagnostic candidate

Implemented default-off bounded in-memory timing collection for typed submission/completion and voice capture/transcription/submission/correlated completion/native playback. Voice sheet has explicit Enable/Disable timing and Copy timings. Export contains fixed stage names, local numeric trace IDs and elapsed milliseconds only. No text/audio/private session identifiers or provider credentials are exported. See [diagnostic operations and limits](conversation-timing-diagnostics.md).

Independent Sol/xhigh review cleared candidate v3 after two remediation cycles addressing three findings: cross-session completion matching; callbacks arriving after audio disposal; event deduplication after export-buffer eviction. Main independently passed the initial full offline aggregate (334 checks), workspace typecheck and contract drift check. After repairs, main reran affected manager/collector tests (110 pass) and playback/controller tests (43 pass); unchanged-module evidence was retained. No native/live/phone/acoustic tests or performance improvement claims. Monotonic player status is a proxy for sound, not an acoustic measurement.

Exact candidate hashes, per-file pre-edit baselines, scoped review packet and orchestration ledger are saved locally under ignored `.artifacts/conversational-phase0/` and `.codex/orchestrator/conversational-experience.md`. These records separate this phase from the extensive pre-existing uncommitted 0.3.1 audit repairs.

## Home Dashboard protection

Read-only investigation identified the separate sibling Home Dashboard and its deliberately isolated dashboard-local/dashboard-qwen profiles, local routes, empty cloud fallbacks, scoped MCP grants and GPU scheduling. Mobile presets must use canonical per-session policy changes. No Home profile, grants, MCP, scheduler, gateway, credential, model, Tailscale or runtime configuration was changed. No inference/provider/GPU work was started.

## Commit/progression prerequisite

On 18 November the owner authorized committing the reviewed baseline separately and continuing all phases after independent review/remediation. Baseline commit: `364006c`. Phase 0 is being committed separately against that baseline; no Phase 1 implementation has been made yet. Phase 1 source investigation is prepared; native-voice and credit-enforcement gates remain as described in the [primary plan](../../HERMES_ANDROID_CONVERSATIONAL_EXPERIENCE_PLAN.md).

This record is an implementation checkpoint, not completion of the full roadmap or a tested release APK.

## Phase 1 — conversation presets

Implemented Fast/Balanced/Deep choices gated to enabled existing OpenAI-Codex catalog entries, authoritative Custom/current labeling and atomic per-session model+reasoning mutation. Existing advanced model/reasoning/favourite controls remain. Saved but unadmitted prompts prevent a preset change; no profile defaults/configuration changed.

Independent GPT-6.1 Sol/xhigh review cleared v3 after two remediation cycles: initial preset confirmation locking/stale alerts and send-admission ordering, followed by shared ownership for existing advanced confirmations. Main passed the full host aggregate before repairs, then affected manager suite (109), preset helper suite (4), workspace types and whitespace checks after repairs; unchanged-module evidence was retained. See [mode behavior and limits](conversation-modes.md). No live provider/phone tests or speed improvement claim.

Phase 1 commit: `408c9cb`. A subsequent authenticated read-only runtime/catalog check through the configured tailnet endpoint reported canonical readiness, authenticated OpenAI-Codex and all three preset model IDs listed without an unavailable flag. No session was created and no inference occurred; quality/effective execution/latency remain unmeasured.

## Phase 0 tooling follow-up

Added unique per-run benchmark folders, an explicit manual live-invocation guard and offline timing summaries with arm-separated sample counts, medians, nearest-rank p95, failed/incomplete runs and missing measurements. The live flag is not a credit/resource authorization mechanism; no live benchmark was run. The standalone offline suite is now in test:host.

Independent GPT-6.1 Sol/xhigh tooling review cleared the candidate with no correctness findings. Main passed all four unit checks, additional synthetic CLI/error-sanitization/size/20-sample percentile checks, and the full offline host aggregate. One trace per wrapped event input and comparable-workload selection are documented limits. See tools/smoke/README.md. This change is committed separately from the Phase 2 app candidate.
