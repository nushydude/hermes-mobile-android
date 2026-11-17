# Current implementation and acceptance

Recorded 18 November 2026. This is a documentation snapshot, not a live service-health check.

## New preview candidate

[0.3.2 (9)](releases/0.3.2.md) is built and not installed. Reviewed conversational controls, timing diagnostics and observed-task visibility are implemented. Main's 386 offline checks, types, contract drift, native build and APK integrity checks pass. Device, real-child and performance acceptance remain open; native duplex voice is deferred behind continuity and included-credit hard-stop gates. No Hermes/Home Dashboard configuration or account/plan changes were made. See the [execution record](plans/conversational-experience-execution.md) and [owner checklist](plans/conversational-phase5-acceptance.md).

## Release

Last recorded successful installation: **[0.3.1 (8)](releases/0.3.1.md)** on the owner's Pixel.
`adb install -r` returned Success and package metadata confirmed version/code. Previous installed
build: 0.3.0 (7). No app launch or phone behavior tests were performed during this installation.

The installed update includes all eight
[source-audit repairs](audits/2026-11-17-remediation.md), narrow duplication removal and independent
Sol/xhigh review. Main's 328 offline checks, types and package integrity passed. Native behavior
remains owner acceptance.

## Implemented

| Area | Behaviour | Evidence and limits |
| --- | --- | --- |
| Sessions | Shared sessions, switching, metadata actions and filters | Real gateway handoff proved in Milestone 2; current full phone matrix remains open. |
| Chat | Streaming, Markdown/code, images, requests, queue/steer/stop, message actions and quotes | Host checks pass; current native selection/layout require owner acceptance. |
| Search | Loaded-session search and Find in loaded visible messages | Stored inventory cap is 200 without pagination; not full-history search. |
| Recovery | Origin-scoped cache, durable IDs, replay, aliases and unknown delivery | Fake-server and selected real gateway probes pass; physical network-loss matrix remains. |
| Models | Mobile provider policy, local favourites and Hermes reasoning picker | Policy mutation/reset tested; clamping displayed, not advertised as native per-model support. |
| Voice | Foreground Review first/Hands-free, calibrated meter, transcript and final-reply playback | Gateway audio smoke passed. Owner reported hands-free endpoint failure; 0.2.4 repair installed but microphone behaviour is not yet accepted. |
| Notifications | Local previews/actions/monitor plus PC-to-ntfy | Owner confirmed receipt and improved alerts; closed-app/request-resolution/watch coverage incomplete. |
| Sharing | Explicit recipient, review, private inbox and durable image drafts | Native compile, JVM and host checks pass; cold/warm intent and URI grants require phone checks. |

The owner confirmed basic app operation and notification receipt. Do not infer all acceptance
checks passed from those reports or installation success.

## Remaining acceptance and limits

- Phone: selection, Find jumps, keyboard/large text, shared images, quiet/noisy hands-free, headset
  routing, cleanup, multiple sessions and Desktop handoff.
- Notifications: closed/locked phone, real request/resolve/clear, overlap between delivery paths,
  Windows logon startup and automatic-turn noise. The ntfy worker is best-effort.
- Voice uses complete-file STT, normal agent work and final-reply TTS. No live transcript,
  provisional-delta speech or background microphone. Room calibration needs brief initial quiet.
- Abrupt noise may resemble speech; very loud calibrated noise follows bounded no-speech handling.
- Shared-image provider reads have a 15-second deadline. Two permanently stalled native workers
  can remain until recovery/process restart. Android can redeliver a reviewable share after process death.
- Cache previews may be evicted; uploaded draft-image references remain.
- Dedicated production signing is not configured. Current APKs use debug signing with the retained
  installed certificate. Signing-key preservation/backup has not been established as complete.
- Latest recorded npm audit: three moderate build-tool findings; no forced downgrade applied.

## Verification snapshot

0.3.0 has **301 distinct offline checks**: 294 host, two plugin and five JVM checks, from a full
baseline plus final affected-suite reruns. Strict types, vendor drift, release build and APK
integrity passed. Independent native and client source reviews cleared their repairs.
See [verification](verification.md) for precise scope.

The public-repository preparation updates documentation and host-tool configuration, without
changing app runtime code or the installed APK. It adds explicit gateway/notification origins
and portable Hermes-home settings. Offline checks and publication scans are separate from the
historical release evidence; no new phone or live-gateway tests were run for this preparation.

## Future scope

Saved answers, export, full-screen editing, shortcuts, themes, background media, broader files,
branches and full-history indexing remain research proposals or uncompleted plan items. They were
not authorized by the six-part 0.3.0 batch. Consult PLAN before starting another batch.
