# Hands-free voice and mobile polish — 17 November 2026

Owner authorizes this batch: hands-free turns in the current session with the selected model and
reasoning; installed version in Settings; actual notification permission state; dismissible drawers
with a top-right close icon; distinct action icons/colors; haptics; scroll polish; investigate and
reduce response delay. Keep the existing Warm forest appearance. Preview is illustrative.

## Voice flow

Manual Review first remains available. Hands-free is explicit opt-in with Start conversation:
listen → speech followed by a short pause → stop/transcribe → ordinary durable send → exact own
completed response → speech playback → resource release/cooldown → listen again. No new session,
auxiliary voice model, reasoning mutation, `voice_turn`/`voice_context`, background microphone or
automatic approval. Pause/End/background/navigation immediately stop local capture and playback;
accepted Hermes work continues. A top-right X/backdrop dismissal ends voice as before.

Use one native metering reader for both elapsed recording display and endpoint detection. Adaptive
noise/hysteresis and sustained speech reduce accidental sends. Missing metering, long polling gaps,
bounded no-speech retries, errors, timeout, disconnection and approval/clarify/secure input pause the
automatic loop. Resume is explicit and cannot duplicate unresolved accepted work. Speaker playback
and capture never overlap; only natural completion of the current automatically matched reply can
rearm. Stop, Pause, manual Read/Replay and stale callbacks must not be confused with natural finish.
The microphone visibly indicates active listening; no invented live transcript before STT finishes.

Keep finalized-answer speech: canonical deltas may be interim narration and are not immutable final
sentences. Shorten the first natural speech part to roughly 250–400 characters and prefetch at most
one next part, bounded to two owned audio resources. Retain cancellation/resource ownership and
same-session reply identity. Measure STT, receipt, first text, completion and short/large TTS stages.
No guarantee is made that selected model/reasoning computation can finish in one second.

## Drawers and settings

- Shared bottom sheet with outside-tap dismissal and 48dp top-right X; keyboard/safe-area support.
  Preserve busy-close guards, form drafts and request generations. Remove redundant Close rows.
- Rename: blue pencil; Pin/Unpin: mint pin; Archive: amber archive; Delete: coral trash with existing
  confirmation. Color accompanies icon/text, not the sole meaning. Keep direct Ionicons imports.
- Notifications reflect actual native permission state on open/foreground/after request. Enabled
  shows Notifications enabled and Manage notifications; blocked state opens system settings.
- Installed version comes from native application metadata, not a fake latest/up-to-date check.
  New release version0.2.0/build2 distinguishes it from the previously installed0.1.0/build1.
- Haptics for accepted long press/menu selection and deliberate actions, respecting system haptic
  preferences; haptic failures never block the action. No vibration for streamed text or scrolling.

## Scrolling

Explicit follow-latest intent stops immediately on user drag. Suppress automated following during
drag/momentum/history prepend; coalesce adjustments and invalidate scheduled work on session or
endpoint changes. Preserve visible history while paging older rows, use stable IDs and a list scoped
to the session. Jump-to-latest overlays the list, never changes its viewport height. Do not reorder
the whole timeline or modify the durable state/protocol layer merely for scrolling.

Tests cover ownership, silence/noise and gaps, natural-versus-stopped playback, duplicate/foreign
completions, interrupted loops, metering absence, pause/late callbacks, notification state and scroll
intent. Main measures gateway timings, runs host checks, independent source review and APK checks.
Owner native acceptance remains needed for real voice thresholds, routing, haptics and scroll feel.

## Screenshot-led follow-up in the same batch

New chat starts with two compact selection cards, Workspace and Model, and an immediately reachable
Start chat action. Each card opens its own focused searchable list; selection returns to the summary.
Keep configured-only models, provider identities, disabled entries and gateway defaults. An empty
chat has a centered invitation to start; history paging appears only once history exists.

Settings shows the background monitor's actual runtime state alongside its selected policy, including
running/waiting/starting/off and startup failure. When running, also show the current gateway
connection state. Canonical pending admissions already running must not look like queued messages;
only queued entries get queue controls, with uncertain delivery shown separately.


## Owner-reported hearing/endpoint repair - 17 November 2026

Replace the decorative listening pulse with real native-level bars from the same single meter
stream. Initially ask for brief quiet during room calibration; show Mic ready, Speech detected,
Pause detected with1300ms progress, then Transcribing. Actual recognized words appear only after
full-recording STT. Keep an immediately reachable stop control and Finish speaking button as a
fallback to the same exactly-once path. Recognized sent words remain visible while waiting.
Review first shows elapsed wait and preserves its exact reply watcher for longer-running tasks;
audio starts after final completion. Continuous calibrated loud noise fails closed. Abrupt noise
and talking through calibration remain limits; physical Pixel acoustic testing belongs to owner.
