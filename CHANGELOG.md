# Changelog

User-facing history recorded 17 November 2026. Version numbers identify the app, not the root
npm workspace. Artifact identity and acceptance are in [release records](docs/releases/README.md).

## 0.3.1 (8) - 17 November 2026

- Preserve draft images through delayed deletion cleanup and protect composer text when opening queued edits.
- Keep running replies intact during authority refresh and retire failed subscription acquisitions safely.
- Add request-owned Cancel/Android-back handling for secure input.
- Release completed stream buffers and clear recovered storage warnings without hiding unrelated errors.
- Give smoke probes unique fixture ownership, centralize credential parsing, and include plugin checks in the offline aggregate.
- Share preference persistence and secure UUID generation; advertise the actual app version to the gateway.
- Build/review and artifact acceptance are recorded in the release note; installation remains separate.

## Public repository preparation - 17 November 2026

- Public source repository, README, MIT license, contribution/security guidance and retained upstream notices.
- Architecture, setup, verification, release records and retrospective ADRs.
- Explicit host-tool gateway/notification origins and configurable Hermes home; personal setup records stay local.
- Offline CI checks on Linux and Windows. No app runtime or installed APK changes in this preparation.

## 0.3.0 (7) - 17 November 2026

- Long-press message actions, native text selection, sharing and quotes appended to the current draft.
- Find/highlight/previous-next navigation in loaded visible messages.
- All/Running/Needs you/Unread/Drafts filters, including saved image-only drafts.
- Android text/URL/image sharing with explicit recipient review, private inbox and bounded provider I/O.
- Durable image drafts and recovery across session aliases/cache reconciliation and failed sends.
- Provider-specific local model favourites and explicit Hermes reasoning choices with effective-level reporting.
- Installed successfully after owner Play Protect review; new phone behaviour remains owner acceptance.

## 0.2.4 (6) - 17 November 2026

- Real microphone levels, room calibration, speech/pause feedback and Finish speaking fallback.
- Noise-relative hands-free endpoint detection and safe handling of saturated calibrated noise.
- Recognized sent words and elapsed reply waiting; manual voice keeps its exact reply watcher for long tasks.
- Installed; hands-free acoustic behaviour still requires owner confirmation.

## 0.2.3 (5) - 17 November 2026

- Session titles, bounded expandable reply previews and distinct stopped/failed/request notification copy.
- Latest reply replaces earlier completion alerts within the same origin/session.
- Installed; owner confirmed the improved notification worked.

## 0.2.2 (4) - 17 November 2026

- Composer grows with wrapping/newlines to approximately six lines, then scrolls internally.
- Enter inserts a newline; Send remains explicit; action controls stay bottom-aligned. Installed.

## 0.2.1 (3) - 17 November 2026

- Both model pickers retain OpenAI and saved custom/local providers while excluding borrowed CLI logins.
- Preserves provider identity and unavailable states. Installed.

## 0.2.0 (2) - 17 November 2026

- Opt-in foreground hands-free voice in existing sessions, retaining selected settings.
- Installed version, actual permission/monitor status, dismissible sheets, action icons/colours and haptics.
- Scroll-intent handling, compact new-chat selectors, empty-chat welcome and correct queued/started presentation.
- Installed; later endpoint and feedback repair is recorded under 0.2.4.

## Earlier dated builds

Initial shared-session UI, provisioning, recovery/security repairs, notifications, Warm Forest and
manual voice/playback work preceded this versioned sequence. Multiple historical candidates were
recorded by date/hash. Consult the [preserved journal](docs/history/PC_SETUP_HISTORY.md) and dated
audit reports rather than assuming all earlier APKs have uniquely identifying version metadata.

## Documentation consolidation - 17 November 2026

Added a documentation map, current status, architecture, ten retrospective ADRs, development and
verification guides, current setup runbook, release evidence and preserved history. No runtime code,
APK, signing key, machine configuration or service changed during this documentation-only work.
