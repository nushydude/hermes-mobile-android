# Verification and acceptance

Host tests, gateway probes, installation and phone acceptance establish different things.
This distinction is part of the release process; see [current status](STATUS.md).

## Offline checks

From the repository root:

```powershell
npm run typecheck
npm run test:host
```

Host tests cover transport/state, helpers, voice/resource ownership, notification adapters and
PC hook logic with fixtures. The aggregate also includes incoming-share manifest plugin checks
and smoke-fixture ownership tests. It does not contact the gateway or drive the phone.

Contract drift is a separate local check: `npm run check:contract` reads an external Hermes
source checkout. Set `HERMES_SOURCE` if it is not in the default location; a missing checkout is
not a successful drift check.
Dependency/bootstrap tools may need network access independently of the test traffic.

Native share-policy and blocked-provider tests:

```powershell
. tools/android/env.ps1
Push-Location app/android
try { .\gradlew.bat :hermes-sharing:testDebugUnitTest --console=plain } finally { Pop-Location }
```

Prebuild/autolinking must exist first. JVM results do not prove Android intent delivery or grant
lifetime. Historical 0.3.0 evidence combines a full baseline with affected-suite reruns: **294 host
checks + 2 plugin checks + 5 JVM checks = 301 distinct checks**, not 301 physical phone tests.

## Performance capture

`npm run bench` prints host counts (cache writes, characters serialized, live-text work) for the
state manager; see [the benchmark guide](../tools/bench/README.md). It needs no phone. Phone
captures add frame times and the app's own timings. They need an owner-authorized Preview install.

1. In Home settings, turn on **Collect response timings**. It is memory-only and off after every
   app start, so the cold-start `cache_restore_ms` sample is not captured this way.
2. Before each scenario, reset frame statistics:
   `adb shell dumpsys gfxinfo net.taild39a23.hermesmobile reset`
3. Run one scenario, then save
   `adb shell dumpsys gfxinfo net.taild39a23.hermesmobile framestats` to a file under
   `.artifacts/perf-capture/<date>-<build>/`:
   - **Typing:** type 200 characters into the composer of a chat with at least 50 loaded rows.
   - **Streaming:** ask for a reply of about 4,000 characters and keep the chat open until it
     completes.
   - **Opening:** from Home, open five different chats in sequence, returning to Home between them.
4. After each scenario, tap **Copy response timings** and save the clipboard next to the frame
   file. It holds trace stages, duration samples (`persist_ms` with payload size,
   `session_open_ms`, `connect_ready_ms`, `cache_restore_ms`) and render counts for `ChatScreen`,
   timeline items, the live message and the composer. Turn the switch off and on to clear it
   between scenarios.

Summarize timings with `node tools/smoke/timing-summary-cli.mjs` (see the
[smoke guide](../tools/smoke/README.md)). Record the build, device and scenario with each capture.
Frame statistics and timings never include message text; check before attaching any other log.

## Explicit live gateway checks

These use the real gateway; read the [smoke guide](../tools/smoke/README.md) before running them.

| Command | Effect |
| --- | --- |
| `npm run probe:package` | Read-only inventory/resume/detach of an idle Desktop session; no submission. |
| `node tools/smoke/model-options-probe.mjs` | Read-only catalog/metadata checks; compiled protocol runtime must exist. |
| `node tools/smoke/reasoning-picker.mjs` | Creates/resumes/mutates/archives owned idle fixtures; no LLM turn. |
| `npm run probe:app` | Creates owned fixtures and real agent/image turns, then archives; native adapters mocked. |
| `npm run probe:recovery` | Creates fixtures, deletes one and tests reconnect/receipt behaviour; remaining fixture archived. |
| `npm run smoke` | Attended protocol exercise, with real prompts/uploads; separate Desktop/approval checks required. |

Audio/latency probes also perform real HTTP/provider work and may create/submit to owned sessions.
They are not passive health checks and must not be run as a docs-link test. Preserve failures and
cleanup records. Read only the needed deployment-token assignment privately; never dump .env,
read auth.json, print raw credential-bearing errors or mutate personal sessions.

## APK checks

Record source/version identity, build outcome, byte size/SHA256, signing certificate, application
ID and Android manifest. Verify embedded JavaScript, native module export where relevant, cleartext
disabled, RECORD_AUDIO present, remoteMessaging-only foreground service and one required icon font.
Credential scanning must report counts rather than credential values. Local historical evidence
is under ignored `.artifacts/`; portable release facts belong in [release notes](releases/README.md).

## Installation

An owner-authorized `adb install -r` Success proves package installation/update, not runtime flows.
Play Protect is an owner-side step. Preserve data and signing identity; do not uninstall to bypass
an update failure. The owner requested to perform device behaviour testing personally.

## Owner phone checklist

- Cold start: cached readable list, connection recovery and quiet grace.
- Three concurrent sessions; no stream loss while switching; Desktop-phone handoff both directions.
- Long-press actions, exact selection/quotes, loaded-message Find, history anchors and long-chat scrolling.
- Text/image drafts across navigation/restart; filters/counts including image-only drafts.
- Growing composer, keyboard, large text, touch targets and TalkBack labels.
- Camera/gallery and cold/warm Android shares, multiple images, HEIC, offline/cancel recovery and correct recipient.
- Explicit model/provider/reasoning choices, effective effort, deferred change and favourites after restart.
- Hands-free calibration, speech/pause feedback, automatic exactly-once send, quiet/noisy rooms and fallback.
- Review-first long wait, matching reply playback, controls, headset routing and background/navigation cleanup.
- Local notifications while backgrounded/locked, safe actions, deep links and channel/watch settings.
- PC/ntfy with Hermes Mobile closed, request resolution/clear, path overlap and Windows logon startup.
- Network loss/reconnect, offline outbox, replay gaps and uncertain-delivery recovery.
- Gateway restart recovery only in an owner-approved restart window; never restart just to complete this checklist.

Owner reports establish only the exercised flow. Record build, date, steps, expected/actual result
and any failures rather than marking a whole milestone accepted after an APK installs.
