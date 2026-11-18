# Conversational experience execution record

17 November 2026, Australia/Sydney. Owner authorized implementation with independent GPT-6.1 Sol / Extra High review and remediation after every phase. Owner subsequently authorized overnight commits/progression after review, stopping for consequential configuration changes or blockers.

## Phase 0 diagnostic candidate

Implemented default-off bounded in-memory timing collection for typed submission/completion and voice capture/transcription/submission/correlated completion/native playback. Voice sheet has explicit Enable/Disable timing and Copy timings. Export contains fixed stage names, local numeric trace IDs and elapsed milliseconds only. No text/audio/private session identifiers or provider credentials are exported. See [diagnostic operations and limits](conversation-timing-diagnostics.md).

Independent Sol/xhigh review cleared candidate v3 after two remediation cycles addressing three findings: cross-session completion matching; callbacks arriving after audio disposal; event deduplication after export-buffer eviction. Main independently passed the initial full offline aggregate (334 checks), workspace typecheck and contract drift check. After repairs, main reran affected manager/collector tests (110 pass) and playback/controller tests (43 pass); unchanged-module evidence was retained. No native/live/phone/acoustic tests or performance improvement claims. Monotonic player status is a proxy for sound, not an acoustic measurement.

Exact candidate hashes, per-file pre-edit baselines, scoped review packet and orchestration ledger are saved locally under ignored `.artifacts/conversational-phase0/` and `.codex/orchestrator/conversational-experience.md`. These records separate this phase from the extensive pre-existing uncommitted 0.3.1 audit repairs.

## Home Dashboard protection

Read-only investigation identified the separate sibling Home Dashboard and its deliberately isolated dashboard-local/dashboard-qwen profiles, local routes, empty cloud fallbacks, scoped MCP grants and GPU scheduling. Mobile presets must use canonical per-session policy changes. No Home profile, grants, MCP, scheduler, gateway, credential, model, Tailscale or runtime configuration was changed. No inference/provider/GPU work was started.

## Commit/progression prerequisite

On 18 November the owner authorized committing the reviewed baseline separately and continuing all phases after independent review/remediation. Baseline commit: `364006c`. At that checkpoint Phase 0 was prepared separately and Phase 1 had not started. Subsequent completed checkpoints are recorded below; native-voice and credit-enforcement gates remain as described in the [primary plan](../../HERMES_ANDROID_CONVERSATIONAL_EXPERIENCE_PLAN.md).

This record is an implementation checkpoint, not completion of the full roadmap or a tested release APK.

## Phase 1 — conversation presets

Implemented Fast/Balanced/Deep choices gated to enabled existing OpenAI-Codex catalog entries, authoritative Custom/current labeling and atomic per-session model+reasoning mutation. Existing advanced model/reasoning/favourite controls remain. Saved but unadmitted prompts prevent a preset change; no profile defaults/configuration changed.

Independent GPT-6.1 Sol/xhigh review cleared v3 after two remediation cycles: initial preset confirmation locking/stale alerts and send-admission ordering, followed by shared ownership for existing advanced confirmations. Main passed the full host aggregate before repairs, then affected manager suite (109), preset helper suite (4), workspace types and whitespace checks after repairs; unchanged-module evidence was retained. See [mode behavior and limits](conversation-modes.md). No live provider/phone tests or speed improvement claim.

Phase 1 commit: `408c9cb`. A subsequent authenticated read-only runtime/catalog check through the configured tailnet endpoint reported canonical readiness, authenticated OpenAI-Codex and all three preset model IDs listed without an unavailable flag. No session was created and no inference occurred; quality/effective execution/latency remain unmeasured.

## Phase 0 tooling follow-up

Added unique per-run benchmark folders, an explicit manual live-invocation guard and offline timing summaries with arm-separated sample counts, medians, nearest-rank p95, failed/incomplete runs and missing measurements. The live flag is not a credit/resource authorization mechanism; no live benchmark was run. The standalone offline suite is now in test:host.

Independent GPT-6.1 Sol/xhigh tooling review cleared the candidate with no correctness findings. Main passed all four unit checks, additional synthetic CLI/error-sanitization/size/20-sample percentile checks, and the full offline host aggregate. One trace per wrapped event input and comparable-workload selection are documented limits. See tools/smoke/README.md. This change is committed separately from the Phase 2 app candidate.

## Phase 2 — unified foreground speech controls

Added shared single-owner playback, explicit Speak replies, exactly correlated typed readback, and Type instead using the existing durable draft import. Independent GPT-6.1 Sol/xhigh review required two remediation cycles: active hands-free mute must pause until Resume, transcript transfer needs synchronous ownership/revision fences, revoked leases must invalidate capture/STT callbacks, and rejected transfers need a safe recovery path. Final R2 independently cleared with no remaining actionable source findings.

Main passed the full host aggregate on the initial candidate, then affected checks after repairs (final R2 component suite46; manager110 and preferences/types after R1). Unchanged-module evidence retained. A no-inference empty speech-stream handshake minted a scoped ticket, opened the socket and received start/end metadata with zero binary frames. No text/audio was submitted for inference. This verifies transport only. Native PCM/streaming STT remain conditional on measured need and approved device/provider acceptance; no speed win is claimed. See [Phase2 behavior](conversational-phase2.md).

Phase2 commit: `e69d13b`.

## Phase 3 — native voice gate

Evaluated and deferred: installed upstream lacks the required supported same-session external exchange commit, and included-credit hard stops remain unverified. Independent GPT-6.1 Sol/xhigh outcome review cleared this decision with no tools, based on supplied source/status evidence. Native voice remains disabled; no new account/plan/provider/credential/configuration was introduced. Continue safe independent phases. See [gate evidence and reopening requirements](conversational-phase3-gate.md).

## Phase 4 — observed background tasks

Implemented bounded per-origin/parent task observations, persisted cache with memory fallback, task tray, parent-scoped child transcript reads, specific child stop requests and replay-deduplicated terminal notifications. The tray exposes existing work; it does not dispatch or promise detached execution. Missing unfinished children become Unknown; explicit terminal evidence is retained. See [contracts and limits](conversational-phase4.md).

Independent GPT-6.1 Sol/xhigh review cleared R1 after repairing session-specific refresh fencing, deterministic first-terminal restore ordering and optional-cache initialization failure. Main passed the pre-repair complete380-check aggregate/types/contract; final repaired aggregate and APK evidence are recorded in the release record. No real child inference, phone or background lifecycle acceptance was run. The owned empty-session contract fixture was archived without a prompt.

Phase4 commit: `c6b6bae`.

## Phase 5 — foreground reliability and accessibility

Added accessible disabled states, polite voice phase/error feedback, wrapping voice controls with retained touch targets, and an explicit transient non-mixing playback audio mode shared with capture configuration. Independent GPT-6.1 Sol/xhigh source review cleared the initial candidate with no actionable findings. Main's complete host run includes these changes; the implementor also passed74 focused checks and types. Tests exercise real adapter acquisition, cancellation during mode setup and mode failure cleanup.

The installed SDK player requests focus and may resume after a transient interruption; its recorder does not itself request audio focus. No capture-interruption safety or rendered large-text/TalkBack behavior is claimed from these checks. The [owner acceptance matrix](conversational-phase5-acceptance.md) records device, call, routing, draft, reconnect and task checks still required. No new background microphone/service or theme system was introduced.

Phase5 commit: `0e4921e`.

## Phase 6 — built owner-test preview; acceptance open

Version 0.3.2/build9 is packaged with the retained signing certificate. Main passed the final 386-check host aggregate, workspace strict types, contract drift and whitespace checks. Final incremental Android release build passed; 146 app/package source hashes stayed unchanged across packaging. APK identity, manifest, font, bundle and exact deployment-token scans pass. See [release evidence and remaining acceptance](../releases/0.3.2.md). At candidate freeze the preview had not been installed or exercised on the phone, and no real inference, task execution or performance benchmark was run. No account/plan, Hermes/Home Dashboard configuration, signing migration or paid fallback change was made.

Independent GPT-6.1 Sol/xhigh release outcome review cleared this frozen version/documentation/evidence packet after clarifying that fixture creation/archival were mutations of an owned empty session, distinct from its read-only queries. No actionable findings remain in the reviewed preview scope. The full roadmap is not accepted as complete: native voice is deferred and owner hardware/performance acceptance is outstanding. Token totals for main and children are unavailable from this runtime; no billed total is inferred.

## Owner-authorized installation — 18 November 2026

Verified the connected Pixel's installed 0.3.1/code 8 APK certificate equals the 0.3.2/code 9 candidate certificate, then ran only `adb install -r` for the new versioned APK. It returned Success. Package metadata confirms 0.3.2/code 9 and original first-install time 16 November 2026 08:00:23 remains unchanged. No uninstall, data clearing, launch or phone behavior test was performed. Existing app data is retained by the in-place update; the owner will verify drafts/history/settings in the acceptance checklist.

## Pairing follow-up — 18 November 2026

Owner reported connection failure after the update, then confirmed opening Tailscale on the phone restored connectivity. An authenticated gateway readiness check passed without inference. Blank setup fields do not establish credential loss; the setup form initializes blank. Pairing/troubleshooting instructions now put phone Tailscale Connected before re-pairing or clearing anything.

Added the owner-requested default-profile `hermes-mobile-pairing` skill and a launcher fallback to the existing configured public URL, with explicit-origin precedence and a no-QR configuration check. The existing local-window QR/120-second clearing behavior remains. Installed skill bytes match the repository source, and Hermes's own skill catalog discovers it. No gateway restart, credential rotation, profile/MCP/grant change or Home Dashboard modification was made.

Independent GPT-6.1 Sol/xhigh source/test/documentation review cleared pairing v1 with no actionable findings and zero reviewer tool calls. Main verified real configuration CheckOnly, skill frontmatter validation, and mocked-window launch/privacy/precedence/rejection/environment-restoration scenarios in both PowerShell 7 and Windows PowerShell 5. No model-driven invocation or new QR was generated by those tests; the earlier owner-requested QR was displayed only in a local window. No Android source or APK changed for this follow-up.
