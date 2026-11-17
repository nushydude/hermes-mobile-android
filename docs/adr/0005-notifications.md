# ADR 0005: Local alerts plus best-effort PC notifications

- **Status:** Accepted
- **Decision date:** 16 November 2026; refined 17 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The owner wants completion and attention alerts while using a phone. The app only receives live
events for subscribed sessions while its connection and process are alive. Android may stop a
background process, and the PC can produce work from Desktop without the phone viewing that session.

## Decision

Use Notifee local notifications for subscribed sessions and an optional foreground connection
monitor. Suppress alerts for the currently visible chat. Show session-titled completion previews and
distinct failure, approval and clarification states; do not put reasoning, approval commands or raw
errors into those previews. Approval actions are limited to offered Allow once/Deny choices and are
revalidated against the current gateway origin, prompt and generation.

Provide a separate tailnet-only ntfy service and Hermes user hook for generic alerts and session
links when the app is closed. The two paths are independent. The PC hook uses a bounded best-effort
queue and does not include prompt or reply content. An external account, including Firebase, requires
the owner's separate choice.

## Alternatives

A local-only foreground connection cannot guarantee delivery while the app is closed or killed.
Firebase would introduce a new external account and was not selected. Running a hook does not itself
establish delivery from every Hermes worker or reliable filtering of all automatic turns.

## Consequences

The ntfy tier uses a separate Android app and tailnet service, and overlapping tiers can duplicate
alerts. Safe workers suppress the inspected hook path; process exit, bounded queues and Android
background limits make delivery best effort. Notification sound, watch and lock-screen visibility
also depend on Android and owner settings. Local notification previews may expose reply text according
to those settings; the ntfy alert remains generic.

## Evidence

[NOTIFICATIONS.md](../../NOTIFICATIONS.md) and the [hook contract](../../tools/notifications/HOOK_CONTRACT.md)
describe activation and limits. A PC-only GUI fixture reached the real HTTPS ntfy API; the owner later
confirmed receiving a local completion notification. Full closed-app Desktop/phone delivery,
approval actions and Android clear behaviour still need owner acceptance.
