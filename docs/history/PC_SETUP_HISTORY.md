> Historical observations from the original installation; hostnames and paths have been generalized. They are not instructions or evidence for another machine.

> Historical evidence log, preserved 17 November 2026. Statements such as "not installed", "phone disconnected", and "work stopped" describe their dated checkpoint. They are not current status. See [current setup](../../PC_SETUP.md), [status](../STATUS.md), and [release record](../releases/0.3.0.md). Later entries supersede earlier observations; no historical phone verification is inferred from host tests.

# Hermes Mobile PC setup

Milestone 1 PC checks completed, 15 November 2026 (Australia/Sydney).
Gate 1 passed: the owner confirmed desktop and Telegram chats work and supplied a phone screenshot
of the token-gated dashboard reached through Tailscale HTTPS. Milestone 2's repaired automated test,
bidirectional desktop handoff and both approval tests passed. See `PROTOCOL_CONTRACT.md`.
The owner subsequently authorized Milestone 3. The native Expo scaffold and protocol package are
present; Milestone 3 validation passed. Work is stopped before Milestone 4's session UI.

For the approval checks, the owner explicitly authorized temporary Manual mode. Backed up config to
`%LOCALAPPDATA%\hermes\config.yaml.pre-mobile-20261115215410.bak`, temporarily set
`approvals.mode=manual`, then restored and verified `approvals.mode=smart`. No additional gateway
restart was performed. The owner confirmed answering the desktop-side approval.

## Changes made

- Initialized Git in `<repository>`.
- Backed up `%LOCALAPPDATA%\hermes\config.yaml` to
  `%LOCALAPPDATA%\hermes\config.yaml.pre-mobile-20261115200633.bak` before changing it.
- Generated 32 cryptographically random bytes, encoded as URL-safe Base64, directly into
  `%LOCALAPPDATA%\hermes\.env` as `HERMES_DASHBOARD_SESSION_TOKEN`. No value was displayed.
- Set `webapp.enabled=true` and
  `webapp.public_url=https://desktop.example-tailnet.ts.net:9120` using `hermes config set`.
  No explicit `webapp.host` override exists; its planned default is loopback.
- Added `.gitignore` exclusions for credentials, signing keys and local build outputs.

With explicit owner approval, ran `hermes gateway restart`. The old gateway drained cleanly.
Added the tailnet-only HTTPS 9120 Serve mapping to `http://127.0.0.1:9120`.
Ask again before a future gateway restart.

## Checks so far

- Before changes, `hermes webapp --status` reported the Webapp was off.
- Existing Serve mappings are HTTPS 443 to `127.0.0.1:8765`, 8443 to
  `127.0.0.1:3187`, and 8444 to `127.0.0.1:4317`. Preserve all three.
- No listener on 9119 or 9120 was reported by the initial listener check.
- `hermes gateway status` confirmed a running gateway process (PID 25708), even though the
  scheduled task itself reports Ready. It also reported pre-existing cross-profile Telegram
  credential warnings and another profile gateway. No migration or messaging/profile changes
  were made; Telegram functionality still requires the owner's check.
- `tailscale status` confirmed `android-device` is offline, last seen 17 days ago.
- Windows Balanced power plan: sleep timeout is zero (never) on both AC and DC.
  No power settings were changed. Manual sleep or shutdown still makes the gateway unavailable.

- After restart, confirmed `127.0.0.1:9120` listening (gateway PID 51888).
- Serve status showed the new HTTPS 9120 mapping and all three previous mappings unchanged.
- `node tools/pc-setup.mjs verify` passed against the Tailscale HTTPS URL using normal TLS
  validation: `/api/status` 200 with `auth_required=true`, `auth_providers=["session-token"]`;
  `/api/auth/me` 401 without credentials and 200 with the provisioned bearer token. This also
  confirms the restarted gateway picked up the `.env` token.
- Gateway log reported Telegram polling healthy, connected, and commands registered after restart.
  This is adapter evidence; the owner still needs to confirm an actual Telegram exchange.
- `hermes sessions adopt` succeeded: adopted all 142 pre-gateway default-profile chats
  (135 desktop, 4 oneshot, 3 tui), with no reported skips. This establishes adoption succeeded;
  remote visibility and continuation will be tested in Milestone 2.

Owner verification: desktop and Telegram both working; the phone reached the token-gated dashboard
at the configured Tailscale HTTPS address. Always-on VPN has been recommended but not confirmed.

### Differences and startup observations

- The restart command launched two gateway processes. One exited after detecting the other;
  PID 51888 completed startup. An early status probe said the gateway was not running, before
  startup finished; later listener and authenticated HTTPS checks passed. No second restart occurred.
- `hermes webapp --status` reports **Unavailable: Webapp is not built**, with missing
  `apps/desktop/dist-webapp/index.html`. Despite that diagnostic, the listener and the tested REST
  API routes work. Do not build the Webapp or modify the Hermes checkout to silence it. WebSocket,
  chat and upload routes remain for Milestone 2 to verify.
- Pre-existing cross-profile warnings remain. No migration, other profile, messaging configuration,
  existing Serve mapping, or Hermes source was changed.

## Setup commands used (reference; do not repeat the restart without approval)

1. Run `hermes gateway restart`, then `hermes webapp --status`.
2. Check the listener remains on `127.0.0.1:9120`.
3. Add only the new mapping:
   `tailscale serve --bg --https=9120 http://127.0.0.1:9120`.
4. Check `tailscale serve status` preserves the existing mappings.
5. From this project run `node tools/pc-setup.mjs verify`. This checks the Tailscale HTTPS URL,
   requires `auth_required=true` and the `session-token` provider, and checks `/api/auth/me`
   returns 401 without credentials and 200 with them. It never prints the token or response bodies.
6. Run `hermes sessions adopt` for the default profile only.
7. Confirm the owner can still use desktop chat and Telegram; turn on Tailscale on the phone.

With only the session-token provider, the browser Webapp on this port has no interactive sign-in
method. This is expected: Hermes Mobile will use the authenticated API with its own native UI.

## Token handling and rotation

The deployment token grants operator access. Keep `.env` outside Git; do not copy it into this
project, logs or chat. Do not read `auth.json`. Phone provisioning must use a QR shown locally once;
the QR flow will be added when the phone setup screen exists. No QR or credential image has been
created yet. Store the phone credential using Android Keystore through Secure Store.

To rotate, with the owner choosing a restart window:

1. Use a local script to replace only the `HERMES_DASHBOARD_SESSION_TOKEN` assignment in the Hermes
   `.env` with a fresh `randomBytes(32).toString('base64url')` value. Never echo it or pass it as a
   command-line argument. `node tools/pc-setup.mjs provision` deliberately preserves existing entries;
   it is for initial provisioning, not rotation.
2. Ask before running `hermes gateway restart` so it reloads the token.
3. Run `node tools/pc-setup.mjs verify` and reprovision the phone by the local QR flow.
4. Verify the former token no longer authenticates, without printing either credential.

## Undo

1. Ask for a gateway restart window first.
2. Remove only the new Serve port using `tailscale serve --https=9120 off`; never run Serve reset
   and never enable Funnel. Verify 443, 8443 and 8444 remain as above.
3. Back up the current config before restoring the pre-mobile backup above. If other settings have
   changed since setup, merge only the Webapp changes instead of restoring the entire old file.
   The pre-mobile Webapp was disabled and had no public URL configured.
4. Remove only the deployment-token assignment added to the Hermes `.env`; preserve all other entries.
5. With approval, restart the gateway; confirm the Webapp is off and desktop/Telegram still work.

## Milestone 3 local Android environment

Installed under ignored `<repository>\.toolchain`:

| Component | Verified version |
| --- | --- |
| Temurin JDK | 17.0.21+9 |
| Android command-line tools | 22.0 (archive 15859902) |
| Platform tools / adb | 37.0.1 / 1.0.41 |
| Android platform | API 37.0, revision 2 |
| Build tools | 37.0.0; native dependencies additionally installed 36.0.0 |
| NDK | 27.1.12297006 |
| CMake | 3.22.1 |
| Gradle wrapper | 9.4.1 |

JDK and command-line tool downloads were SHA256-checked before execution. No Android Studio or
external build account was needed. `tools/android/env.ps1` sets project-local `JAVA_HOME`,
`ANDROID_HOME` and `GRADLE_USER_HOME`; no global environment setting was overwritten.

The owner enabled USB debugging and connected the phone. Actual adb property checks returned
`Pixel 11 Pro XL`, Android `17`, SDK `37` / full SDK `37.0`, ABI `arm64-v8a`, security patch
`2026-10-05`. No phone settings were automated and no APK has been installed yet.

The scaffold uses Expo SDK 58, React Native 0.88.1 and React 19.3.0. Prebuild produces only the
ignored `app/android` native tree. Main, debug and debugOptimized manifests explicitly disallow
cleartext traffic; no cleartext gateway exception or Metro Serve mapping was introduced.
Expo's development network inspector is disabled in build properties.
The app has no token and does not connect to Hermes yet. QR setup and the real session/chat UI
are Milestone 4 work.

See `README.md` for repeatable bootstrap, SDK selection, native build, typecheck and protocol-test
commands. The Android Metro export, app/package typechecks,
25 protocol fake-server tests, vendor drift check and read-only live package probe passed.
Expo Doctor passed all 20 checks. Phone runtime behavior is not claimed by these host checks.

Native `:app:assembleDebug` succeeded (first build 10 minutes 32 seconds; final build after disabling
the development network inspector 1 minute 25 seconds).
Output: `.artifacts/hermes-mobile-development.apk`, 63,863,508 bytes, SHA256
`777c7d727a237708ddb4983c297bdcb5428c140c39e50f7247e3b3a11872f791`.
`apksigner verify --verbose` verified the development APK's v2 signature. `apkanalyzer` read the
packaged manifest: package `net.taild39a23.hermesmobile`, min SDK 24, target SDK 36,
`debuggable=true`, `usesCleartextTraffic=false`. The compile platform is API 37 as required by
the installed React Native version. This is a development-client shell; the final JS bundle is
validated separately and needs a trusted HTTPS Metro endpoint for interactive development.
It has not been installed on the phone. Independent source review cleared the final protocol
repair. Two repair cycles addressed running-reply gaps, subscription cancellation/reopen races,
and ticket-body timeouts. Those races were verified with scripted fake-server tests; the live
package probe verified connection/inventory/history resume, not every simulated failure mode.

The current npm audit reports three moderate findings along the Expo fingerprint/minimatch tooling
dependency chain, with no high or critical findings. The suggested forced fix would downgrade Expo
by several major versions and was not applied. Recheck when updating Expo dependencies.

Release APK installation, stable release signing-key storage and update steps will be added at the
later build/release milestones; the generated development key is not the release signing identity.

## Milestone 4 test build and setup

The app now has native QR setup, session inventory, chat, streaming, approval/clarify controls,
drafts, a durable outbox and SQLite history cache. Android credentials use SecureStore. No token
is included in source code, the bundle or the APK. Existing Serve mappings and gateway config
were not changed during this milestone; no restart was performed.

Build a standalone test APK with `npm run android:preview`. It embeds the JavaScript bundle and
does not need a Metro server. The `Preview` build uses the native release variant signed with
the temporary development key; this is not the later stable release identity. Install/update
with `adb install -r .artifacts/hermes-mobile-preview.apk` after loading `tools/android/env.ps1`.
Do not uninstall to update: uninstalling removes local cache/drafts and provisioning.

On Windows, the safe-area dependency initially exceeded Ninja's 260-character object-path limit.
`app/plugins/withWindowsBuildPaths.js` sets `CMAKE_OBJECT_PATH_MAX=240`, using CMake's object-path
hashing. This is project-local and survives prebuild; no system registry or Hermes checkout was
modified. The resulting native build passed, and its embedded JS, APK v2 signature and packaged
`usesCleartextTraffic=false` were verified.

To provision: enable Tailscale on the phone, open the app's **Scan setup QR code** screen, and run
`npm run setup:qr` on the PC. A separate owner-visible terminal shows a versioned JSON QR containing
the HTTPS origin and token. It writes no QR file and refuses redirected output; Enter or a two-minute
timeout clears and closes the display. Never share or capture that terminal. **Connection setup**
on the home screen allows rescanning after token rotation without discarding pending prompts.

Main executed app-state integration against the real Tailscale gateway: authenticated canonical
connect, inventory, a new test session, durable outbox receipt, authoritative user/assistant history,
incoming prompt from another client, image upload and exact readback, and archive. Native storage
and lifecycle adapters were mocked in that check. It does not replace Android or real Desktop UI
handoff acceptance. Gate 3 remains pending installation and attended phone tests.

The current live inventory check returned 149 merged rows, below the gateway's 200-row cap.
The search limit and exact-title fallback are recorded in `PROTOCOL_CONTRACT.md`. If a gateway
completion omits the committed user-row identity needed for reconciliation, the app conservatively
keeps its local prompt; this can show a duplicate rather than risk dropping typed input. The
observed live run supplied identity and retired the local prompt without duplication.

Final Milestone 4 host candidate: `.artifacts/hermes-mobile-preview.apk`, 30,882,853 bytes,
SHA256 `9b6168cff75bf7646c7ef345eeb7c6b5fb25e63567950af189b14a91b2d0b7ac`.
Main verified 25 protocol tests, 24 manager tests, 10 reducer/UI helper tests, strict typechecks,
vendor drift, Expo Doctor 20/20, the live integration described above, and the final native build.
The APK v2 signature, embedded JavaScript and cleartext=false manifest passed. Scanning all
80 Git-visible files and every APK entry found zero actual deployment-token matches. Independent
source review cleared the final candidate after queue ordering/durability repairs and architecture
review. No APK is installed yet; no private QR has been displayed. Gate 3 is still open.

Installation follow-up, 16 November 2026 (Australia/Sydney): with the owner's authorization,
reverified the same APK hash and installed it on the connected Pixel using `adb install -r`
(`Success`). MainActivity launched with `Status: ok`, and the app process was confirmed running.
The private QR helper was launched in a separate local terminal without capturing its output.
Owner scan/connection confirmation and the remaining attended Gate 3 checks are pending.

The owner subsequently confirmed the app works. A chat keyboard overlap was reproduced and
fixed on 16 November: explicit keyboard padding keeps the composer above the IME in Android's
edge-to-edge window. The updated APK installed successfully with credentials retained. Real Pixel
UI bounds verified the input and Send button above the keyboard. Current preview APK SHA256:
`ee14f45fb394537498c86dc4d5f9b57e40c246643a490e044a09c5f440ce3fe1`.

Follow-up session UI update: Home long-press Rename now opens an explicit prefilled editor, with
Save and Cancel. Settings (also chat settings) now has a device-local **Show reasoning and tool
activity** switch, default off. It affects presentation, keeping required prompts and normal replies.
The owner-requested behavior is recorded in PLAN.md and README.md. Updated APK installed with
`adb install -r` Success; SHA256 `5742a3e96d407b56f130e279202275c18069974ad37517cee3c930e90170c9e9`.
Native editor focus/prefill/keyboard geometry and Cancel were verified on an own test session.
The owner then disconnected the phone; Save/toggle runtime checks and Gate 3 remain pending.

## Continuity-first voice build — 16 November 2026

The voice follow-up uses the existing gateway configuration: local Whisper transcription and
Edge speech synthesis worked through the Tailscale origin. No restart, provider/config change,
new account or Serve change was needed. `PROTOCOL_CONTRACT.md` records the first synthetic
recording's recognition failure, successful second voice, AAC/M4A check and shared-session checks.

In an existing chat, tap the microphone, Record, Stop recording, review/edit, then Send message.
Voice uses the ordinary durable outbox, keeping the chat, model, reasoning and existing typed draft.
The matched reply can play while voice stays open; saved assistant messages also offer readback.
Stop speaking releases playback; End voice releases audio without stopping an accepted Hermes task.
Leaving the chat or backgrounding ends voice. No background microphone service is enabled.

The image-picker plugin's old `microphonePermission:false` setting globally removed microphone
permission, overriding expo-audio. It now carries a voice purpose string. The build helper rejects a
generated manifest with missing/blocked RECORD_AUDIO before Gradle. Main verified the rejection on
the old generated project and then verified the fixed final APK declares the permission.

Voice preview candidate: `.artifacts/hermes-mobile-preview.apk`, 32,581,402 bytes, SHA256
`62812c79d8f1f6597a3775c99ae13fd8e087df30d6072a02ad1d54fc376fca6a`.
Clean release build succeeded; signature v2, embedded JavaScript, one icon font, TLS-only manifest
and no microphone foreground service were checked. Exact deployment-token scans found zero matches
in 145 Git-visible files and all 826 APK entries. Host types, vendor drift and 170 tests pass.
Independent Sol source review cleared the terminal-outcome repair; errors, interruptions, empty
replies and watch timeouts no longer leave a false waiting state. USB installation is pending at
this checkpoint because the phone is not connected. No native
recording, playback, routing, keyboard or lifecycle behavior has been claimed tested on the phone.

Installation follow-up: the owner reconnected/unlocked the Pixel and completed Play Protect.
Main reverified the exact voice APK hash above and `adb install -r` returned **Success**.
No app launch or device behavior tests were performed; microphone/voice acceptance remains with
the owner. Open an existing chat and tap its microphone to try Record → Review → Send.

## Morning-ready audit and voice candidate — 17 November 2026

Latest APK: `.artifacts/hermes-mobile-preview.apk`, **32,591,646 bytes**.
SHA256: `9fb85afc0a0ecef69186d9487aa745314048572d718df613cb75fdfee7fb98dc`.
This candidate is built and verified, **not installed**. The owner requested to install it in the
morning and perform native/device behavior checks personally.

The independent GPT-6.1 Sol/xhigh source audit and separate patch review are documented in
[CODEBASE_AUDIT.md](../../CODEBASE_AUDIT.md). Minimal cleanup retains the existing durable queue, endpoint
isolation and handoff machinery. Corrections preserve drafts on ambiguous Steer, keep model/reasoning
metadata fresh and show local-save warnings in Chat. A real-parser regression also exposed and fixed
an incompatible inherited linkify-it override; the parser now uses its declared compatible dependency.

Voice now formats assistant Markdown for speech while keeping the canonical response intact. Long
replies play in bounded parts beyond the former 4,000-character total limit. Playback provides
Pause/Resume, Replay, Back 10 seconds, speed and a separate Stop speaking control. The panel has a
large mic/control, actual recording timer and a reduced-motion-aware recording halo. Explicit review
and Send, session/model/reasoning, typed drafts and foreground-only capture remain in place.

Evidence: 222 offline host tests, strict workspace types including unused-code checks, protocol
vendor drift and lockfile validation pass. Separate Sol/xhigh review cleared the playback repairs,
native resource tests and presentation delta. The real gateway returned valid audio for three parts
covering 5,322 spoken characters; this is media/API evidence, not phone playback acceptance.

The final APK has a valid v2 signature and the **same certificate as the installed baseline**. Main
verified embedded JS, one icon font, RECORD_AUDIO present, cleartext=false, no background microphone
or playback service, and zero exact deployment-token matches across 150 Git-visible files and all
826 APK entries. Source hashes match the frozen reviewed candidate. No gateway/config/Serve change,
restart, new account, phone test or overnight installation was performed.

Install as an update, without uninstalling or clearing data:

```powershell
. tools/android/env.ps1
adb install -r .artifacts/hermes-mobile-preview.apk
```

Complete any Android Play Protect prompt. For native acceptance, try recording/review/send in an
existing chat, a long spoken reply, pause/resume/replay/rewind/speed, Stop speaking versus End voice,
keyboard and large text, background/navigation cleanup and headset interruptions. A paused reply
should stay paused without timing out. Speed is retained within the open voice panel.

One existing moderate minimatch advisory in Expo fingerprint build tooling remains documented in
CODEBASE_AUDIT.md; no high/critical dependency reports were returned. An incompatible Expo downgrade
or unverified major override was deliberately not included in this minimal change set.

Installation follow-up — 17 November 2026: at the owner's explicit request, main reverified the
`9fb85afc…` candidate hash above and installed it with `adb install -r` on the connected Pixel.
Android paused at Play Protect; after the device-side prompt was completed, adb returned **Success**.
No app launch or device behavior tests were performed. Native acceptance remains owner-owned.

## Hands-free and mobile polish candidate — 17 November 2026

Latest built APK: `.artifacts/hermes-mobile-preview.apk`, **version0.2.0 (build2)**,
**32,644,862 bytes**, SHA256
`052e178b6c6a95ec2694b070b7524db9959edaab498b3b222956bf2139df127f`.
Ready for installation as an update; this candidate has **not been installed**.

Open an existing chat → microphone → Hands-free → Start conversation. Spoken words are sent
automatically after a short silence. The next recording starts only after the exactly matched reply
finishes speaking and a short cooldown. Review first remains available. Keep this screen open;
background/navigation ends voice. Pause conversation/Stop speaking affect local audio, not accepted
Hermes work. Errors, requests, missing metering and connection gaps pause listening. Resolve uncertain
delivery in chat before resuming; never submit a replacement merely because a reply is slow.

Settings now shows installed native version/build, actual notification permission and background
monitor runtime/connection state. Drawers have an outside-tap dismissal and generous X. Session
actions have distinct icons/colors and system-respecting haptics. New chat uses compact workspace/
configured-model selection cards; empty chats have a welcome state. Running admissions no longer
show queue controls/counts; genuinely waiting and uncertain deliveries remain distinguishable.

Verification: 248 distinct offline tests pass across the host suites, strict workspace types,
vendored contract drift and lockfile dependency validation pass. Independent GPT-6.1 Sol/xhigh
source reviews cleared the voice and mobile repairs; a separate queue presentation review cleared
the canonical pending distinction. Candidate1 holds the reviewed runtime hashes; subsequent changes
were test/documentation and the standalone diagnostic probe only. Final source evidence is under
`.artifacts/handsfree-20261117/`. Native release build completed in4m55s. Main verified version/build,
embedded JavaScript, one icon font, RECORD_AUDIO, cleartext=false and remoteMessaging-only foreground
service (no microphone/playback service), valid signature matching the installed certificate and
zero exact deployment-token matches across169 Git-visible files and826 APK entries.

Two bounded real-gateway probes used synthetic audio/text and archived their own fixture sessions.
Latest: transcription1.20s, submission receipt7ms, first text1.64s and full reply2.20s; TTS preparation
1.22s for320characters versus8.28s for1,900characters. First speech section is now short, with only
one next section prefetched. Default fixture was gpt-6-luna/medium; the owner’s chosen model/reasoning
are untouched. These PC-side timings do not establish phone latency or long-session/model latency.
See PROTOCOL_CONTRACT.md. No gateway restart/config/Serve/messaging/provider changes were made.

Owner phone acceptance: first-start microphone permission, quiet/noisy speech and silence boundaries,
several automatic turns, same chat/model/reasoning and Desktop handoff, pause/resume/replay/stop,
approvals/disconnect/background cleanup, headset routing, scrolling/history anchors, keyboard/large
text, new-chat selectors, notification/monitor state and haptics. No phone behavior tests were run.
Token telemetry is unavailable for this task/team.

Installation follow-up — 17 November 2026: at the owner's request, main reverified the version0.2.0/build2 APK SHA256 above and installed it on the connected Pixel with adb install -r. The command returned Success. No app launch or phone behavior tests were run.

## Model-list correction — 17 November 2026

Latest APK: `.artifacts/hermes-mobile-0.2.1-3.apk`, version **0.2.1 (3)**,32,645,246bytes.
SHA256 `5ff0a34687a86568dc0faf80fc962fafae5f8c50533cfe3e047da44af204191f`.
Not installed: the Pixel is no longer visible over USB; the owner has been asked to reconnect.

The real gateway includes18Claude entries even with explicit_only:true because its definition also
accepts other CLI OAuth logins. Both mobile pickers now apply the owner's OpenAI plus saved custom/
local provider policy. Live global and existing-session probes produce15OpenAI and4Ollama choices,
with noAnthropic. OpenAI's model list remains the provider catalog, not an invented per-model allowlist.
No gateway/config/credentials/desktop changes. See PROTOCOL_CONTRACT.md for the distinction.

Four selection tests, strict workspace types and independent Sol/xhigh source review pass. Lockfile
changed app version only, with no dependency changes. Release build succeeded in2m11s using the same
native project with its version metadata aligned. APK version/build, installed signing certificate,
embeddedJS, onefont and zero exact token matches in170sourcefiles/826APKentries verified.
Phone behavior testing remains owner-owned; token telemetry unavailable.

Installation follow-up — 17 November 2026: the owner reconnected/unlocked the Pixel. Main reverified the 0.2.1(3) artifact hash and adb install -r returned Success after the device's Play Protect step. No app launch or phone behavior tests were run.


### Growing composer update — 17 November 2026

Version **0.2.2 (4)**: `.artifacts/hermes-mobile-0.2.2-4.apk`. Empty input remains
one line; wrapped text/newlines grow the editor to approximately six lines (bounded by screen
height), then the native input scrolls. Enter inserts a newline; Send/Queue stays explicit.
Action icons remain bottom-aligned. Draft and transport behavior are unchanged.

Strict workspace type checks and 84 existing UI/helper checks pass. Release build succeeded;
APK version, embedded JS, single icon font and zero deployment-token matches verified.
SHA256: `dbcd1465c89774ee263f8b4bf010997c84caed28b3111cb01a22ffd5313ce3bd`.
Not installed; phone editing, selection handles, keyboard and draft resizing remain owner checks.

Installation checkpoint: owner requested installation with the Pixel connected. Verified candidate SHA256, then adb install -r returned Success for version 0.2.2 (4). No phone behavior tests performed.


### Notification diagnosis — 17 November 2026

Read-only Android diagnostics on the connected Pixel: POST_NOTIFICATIONS granted; Notifee
remote-messaging foreground service running; Hermes update notifications appear in system
notification history. Existing hermes-events channel has importance 3 (DEFAULT), sound=null
and userLockedFields=0. Thus no configured notification sound or HIGH-importance heads-up banner.
Android also reports mListenerHints=2 with the Wear companion notification listener disabling
notification effects. These explain silent delivery; no synthetic alerts or device behavior
tests were run. No settings changed. Existing channel settings need owner attention; the
current client covers subscribed/recently opened sessions while alive, not all Desktop
sessions after force-stop. Tier 2 delivery remains separate work.


### Richer notifications - 17 November 2026

Version **0.2.3 (5)**: `.artifacts/hermes-mobile-0.2.3-5.apk`. Session-titled alerts
include a bounded plain-text final reply preview and expandable detail. Stopped, failed,
approval and clarify notifications have distinct copy. Latest reply replaces prior replies
within the same endpoint/session, while pending requests stay separate. Previews omit reasoning,
approval commands and raw errors. Existing deep links, safe approval actions, replay deduplication,
visible-chat suppression and Android PRIVATE visibility retained. System lock-screen, channel
sound and watch settings still apply; no delivery coverage change.

Strict types, 89 helper/notification tests and independent Sol/xhigh source review pass.
Release APK version, signature (same installed certificate), embedded JS, single icon font
and zero deployment-token source/APK matches verified. No synthetic alerts or phone tests run.
Not installed. SHA256: `9c4629d6b0a147dfcaa08433c5bd446f695faf286735a68fef31c012f13bff1c`.

Installation checkpoint: owner requested installation with Pixel connected. Verified candidate SHA256; adb install -r returned Success for version 0.2.3 (5) after Play Protect. No phone behavior tests performed.


### Hands-free detection and microphone feedback repair - 17 November 2026

Version **0.2.4 (6)**: `.artifacts/hermes-mobile-0.2.4-6.apk`. Not installed.
The owner reported invisible hearing state and no automatic endpoint. Previous fixed speech floor
could treat steady background as speech forever. The new detector calibrates room noise for500ms,
then uses noise-relative start/end thresholds,250ms sustainedspeech and1300ms silence. Real recorder
level bars, speech/pause progress, and reachable Finish speaking controls use the existing single
native meter stream and guarded stop/STT/send path. Be quiet initially until Mic ready appears.
Actual words appear after full-recording STT; recognized sent words stay visible while waiting.

Review first now shows elapsed wait and preserves its exact reply watcher past long tasks instead
of closing it after120seconds. Automatic unresolved-turn pause safety is retained. The owner's
minute-long wait was still a running gateway turn; no model/reasoning or compute latency change.
No streamed live transcript, new provider/account, gateway/config/Serve change or phone test.

Verification:263 distinct offline checks across fullhost run plus affected-suite rerun, strict
workspace types and vendor drift pass. Independent Sol/xhigh source review caught loud-noise
threshold caps; repaircycle1 removed them and added saturation/spike tests. Re-review clear.
APK signature matches installed certificate, nativeversion0.2.4/build6, embeddedJS, oneiconfont,
and zero exact deployment-token source/APK matches verified. SHA256: `ffe34bf823e26c1908413531f7b6f4e76c9c5744441d10b0950edfe7d16cc780`.
Phone acceptance: meter reacts to speech, initialcalibration, pause auto-STT/exactly-one send, resumed
speech resets countdown, noisy/quiet rooms, Finishspeaking fallback, long manual reply eventualaudio,
foreground/endpoint cleanup and original model/reasoning. Abrupt noise may still resemble speech;
speaking during calibration can mask initialspeech; extreme noise safely pauses after bounded no-speech.
Installation checkpoint: owner requested installation with Pixel connected. Verified 0.2.4 (6) APK hash; adb install -r returned Success after Play Protect. No phone behavior tests performed.


### Everyday usability batch - 0.3.0 (7), 17 November 2026

Latest APK: `.artifacts/hermes-mobile-0.3.0-7.apk` (32,699,638 bytes). Not installed.
SHA256: `27c8e5957538a27abfd6e7f09bf9d64c868cff61532c0d5ccfa48d2b8d8ea651`.

Long-press messages for Copy, Select text, Share, Reply about this and eligible Read aloud.
Selected text is quoted into the current draft without sending or replacing existing text.
Find in chat highlights loaded messages and provides previous/next navigation. It does not search
uncached history; difficult unmeasured jumps stop with a clear scroll-closer fallback.
Home now filters All, Running, Needs you, Unread and Drafts. Drafts include image-only work;
Needs you includes requests, uncertain delivery and failed sends. Counts cover loaded sessions.

Star models in either picker to put provider-specific favourites first. Favourites are local and
do not enable additional providers. Chat settings replaces free-text reasoning with explicit
Hermes policy choices, Apply reasoning and current provider-adjusted levels. The real gateway
smoke exercised all eight levels, reset and invalid rejection on an owned fixture without an LLM
turn, preserved model/provider and archived the fixtures. Minimal -> Low and Ultra -> Max on the
default OpenAI-Codex model are reported honestly, not treated as native per-model support.

Android text/URL and image shares open a review sheet. Choose an existing chat or explicitly New
chat (gateway defaults), edit the text, then Add to draft. Existing draft text is retained. Nothing
is automatically submitted. A private native inbox retains source data until the app draft saves.
Image preparation requires the PC/Tailscale upload endpoint; plain text can be drafted offline.
Cancel preparation or close the sheet to keep the source available. The review bar reopens it.
Draft image references persist across session/cache/restart recovery. Previews use cache copies
Android may evict; uploaded attachment references remain. Shared image cap is10,25MiB each and
100MiB total; queued inbox cap is20. JPEG/PNG/GIF/WebP and convertible HEIC/HEIF only, no PDFs.

Native provider reads have a15-second whole-share deadline and two bounded worker threads. A
provider that never returns may occupy those workers until process restart; further image shares
show a busy error while text/inbox remain usable. One share may wait only in memory when the inbox
is full, so make room and re-share if needed. Android redelivery after process recreation can make
another reviewable item; it never automatically sends a duplicate prompt.

Verification:301 distinct offline checks (294 host,2 manifest-plugin,5 JVM) pass across the full
baseline and affected-suite reruns. Strict types and vendor drift pass. Independent Sol/xhigh
native and client repair reviews are clear. Source hashes stayed unchanged during packaging.
Release build completed in3m42s. Main verified native version/build, embedded JS, one icon font,
HermesSharing native export, scoped SEND/SEND_MULTIPLE targets, RECORD_AUDIO, TLS-only traffic,
remoteMessaging-only service type, valid signature matching the installed certificate, and zero
exact deployment-token matches in202 source files/826 APK entries. The existing three moderate
build-tool dependency advisories remain; no package versions were upgraded.

Owner phone acceptance: cold and warm shares from browser/gallery, multiple images and HEIC,
correct recipient while navigating, source retention on cancellation/offline failure, long-press
selection and exact quotations, Find/highlights/older-history jumps, session filters/image-only
drafts, favourites after restart, requested/effective reasoning, keyboard, voice and Desktop handoff.
No phone launch/behaviour tests or installation performed for this candidate.
Installation checkpoint: owner requested installation with Pixel connected. Verified 0.3.0 (7) APK hash; adb install -r returned Success after Play Protect. No phone behaviour tests performed.
