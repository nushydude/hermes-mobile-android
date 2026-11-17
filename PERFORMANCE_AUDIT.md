# Performance audit — 16 November 2026

> Dated evidence report. Installation and phone-availability statements describe their checkpoint. See [current status](docs/STATUS.md) and [release records](docs/releases/README.md) for later work.

The independent auditor used the requested **GPT-6.1 Sol / Extra High** configuration. It found
six confirmed P2 issues; no P0/P1 was asserted from desktop timings. Main implemented all production
repairs personally. No Hermes source, gateway configuration, Serve mapping or notification service
was changed. The phone remains unavailable for physical testing.

## Measured before and after

These are repeatable **offline source workloads on Node/V8**, with fake native/transport adapters
and the installed Markdown renderer. They measure algorithmic work, payload bytes and request
counts. They are not Android frame-time, flash-write, heap, startup or battery measurements.

| Same workload | Before | After |
|---|---:|---:|
| 80 draft edits with eight cached chats | 137,326,080 serialized bytes | 24,071 bytes |
| 40 edits behind a blocked database write | 68,659,880 captured payload bytes | 8,871 bytes |
| 40 unrelated background updates, 12 mounted history rows | 480 Markdown parses | 0 |
| 40 inventory-change broadcasts | 80 list RPCs / 40 cache writes | 4 RPCs / 2 writes |
| Visit 40 idle chats | 40 retained full chats / 2,000 rows | 8 full chats / 400 rows |
| 12,000 reasoning deltas | 12,000 raw entries / 71,994,000 prior references copied | 1 card / 11,999 references copied |
| Five simultaneous reads of the same 1 MiB image | 5 requests / 6,990,700 JSON bytes | 1 request / 1,398,140 bytes |

The reasoning workload preserves all 480,000 characters. Request coalescing starts one live/stored
inventory pair and performs one trailing pair for changes arriving during the request. The image
workload returns a result to all five callers.

## Repairs and behavior

- Typing writes a small, origin-scoped draft checkpoint. Revisions order it against full durable
  checkpoints, so an old draft cannot reappear after a send clears it. Send/outbox/FIFO barriers
  remain durable; typing during connection commits uses the existing full recovery checkpoint.
- Activity is projected incrementally into reasoning streams and tool cards. Arguments, results,
  progress, tool images, notices/errors and required approval/question controls remain available.
- Store subscriptions select the state each screen needs. Historical message cells and list inputs
  remain stable during typing and unrelated streaming; unchanged Markdown is not parsed again.
- Inventory refreshes share one in-flight operation per endpoint and retain a trailing refresh.
- Replaceable history follows the eight-recent-session policy. Active/running sessions, outstanding
  prompts/queues and unavailable-session recovery are protected. Drafts, queued IDs/order, saved
  accepted/completed text and alias drafts remain available even when old replaceable history is
  evicted. Older gateway history loads again when online. There is no claimed fixed total heap,
  transcript-row or local-user-text byte limit; explicitly loaded pages and protected data remain.
- Image downloads share work by origin/endpoint generation/session/path. They support individual
  cancellation, abort when the last caller leaves, time out stalled requests, and clear on gateway
  change/disposal. Retained data URLs have an 8 MiB character-storage budget and 32-entry limit;
  native decoded bitmap memory is not measured by that budget.

The APK inventory found no additional material bundle defect: one arm64 ABI, Hermes bytecode and
release shrinking were already present. No dependency was added for these repairs.

## Verification and limits

The independent auditor reproduced the improvements and reran the state/image, helper, preference
and type checks. Main also ran the prior adversarial recovery fixtures, protocol checks and real
gateway app-manager integration with mocked native adapters. Final source-review and APK evidence
is recorded in `.codex/orchestrator/performance-audit.md`.

Final source review is clear. Checks passed: 67 state/image tests, 13 helper/reducer tests,
32 protocol tests, four preferences/activity tests, strict workspace types, the unchanged eight
smoke-core tests and all 12 prior adversarial scenarios. The final live app-manager check passed.
The APK built and its signature, embedded JavaScript, cleartext setting and credential-absence
scan passed. No installation was performed.

Actual Pixel frame pacing, cold start, peak memory, scrolling and battery still need device tests.
Live Markdown still parses the growing response; its native cost remains a profiling follow-up.
Large multi-photo base64 selection also needs native memory testing; no phone OOM was observed or
claimed. The updated APK has not been installed while device testing is paused.

At this Milestone 4 audit checkpoint, notifications were **unimplemented**. They were scheduled for
Milestone 5 in `PLAN.md`; badges and inline approvals alone did not provide background or closed-app
delivery. Notification support was subsequently built and installed; see [NOTIFICATIONS.md](NOTIFICATIONS.md)
and the installation follow-ups in [PC_SETUP.md](PC_SETUP.md). Native delivery acceptance remains
owner-owned. Firebase still requires the owner's approval.

Baseline, executable fixtures, samples and hash manifests are under ignored
`.artifacts/performance-audit/`. Token usage telemetry was unavailable.

## Voice latency follow-up — 17 November 2026

Two bounded synthetic probes through Tailscale separated STT, canonical admission/first text/final
reply and speech synthesis. Latest:1,195ms STT,7ms receipt,1,643ms first text,2,197ms completion;
320character synthesis1,217ms versus1,900characters8,279ms. First run measured1,813ms versus12,772ms
for the same speech sizes. These expose a substantial synthesis-size cost, without establishing
latency in the owner's long chats or phone/network/native audio pipeline.

The app now uses a short first natural speech section and prefetches at most one next section while
playing. Cancellation owns each obsolete prefetch, including rewinds. It still waits for authoritative
completion because streamed narration may precede further tool work. Selected model/reasoning and
ordinary durable submissions remain unchanged. The probe's own sessions were archived; no gateway
configuration or provider was changed. See PROTOCOL_CONTRACT.md and
`.artifacts/handsfree-20261117/latency.json`. Physical profiling remains owner acceptance.
