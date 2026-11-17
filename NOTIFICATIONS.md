# Notifications

Hermes Mobile has two independent notification paths. Delivery depends on Android, network and gateway behavior; neither path guarantees a notification for every event. Recorded observations and open acceptance checks are in [status](docs/STATUS.md) and [verification](docs/verification.md).

## In-app notifications

Grant notification permission in Settings and choose a background monitor mode: Off, While a turn runs, or Always. The latter modes start while the app is visible; Android can still stop the service or process. Alerts cover subscribed sessions, excluding the session currently visible. They include bounded final-reply previews and distinct completion, interruption, failure, approval and clarification states. Approval actions revalidate the request before responding. Commands, reasoning and raw errors are excluded; lock-screen visibility follows Android settings.

Notification permission, channel sound and watch routing are separate settings. Check Android's per-channel settings and the watch companion if needed. The service uses Android's `remoteMessaging` foreground-service type; see [Android's documentation](https://developer.android.com/develop/background-work/services/fgs/service-types#remote-messaging).

## Optional PC-to-ntfy path

A separate Hermes user hook can publish generic alerts and session deep links through a private ntfy server, including when the app is closed. This requires a separately installed and configured ntfy server and Android client, protected topic access, and a reachable HTTPS endpoint. Set `HERMES_MOBILE_NTFY_URL` to your own HTTPS ntfy origin before running `tools/notifications/prepare-runtime.py`. It generates `.artifacts/notifications/plugin-config.json`. Point the gateway process’s `HERMES_MOBILE_NOTIFY_CONFIG` to that file, or securely copy it to `plugins/phone-notify/config.json` under `HERMES_HOME` (default `%LOCALAPPDATA%\hermes`, or `~/.hermes` when `LOCALAPPDATA` is unset). Restrict file access. Never commit topic credentials, QR links or private runtime files. Review the [hook contract](tools/notifications/HOOK_CONTRACT.md) and scripts before installing or enabling them. Configuration and gateway/plugin reload steps depend on your installation.

The hook is bounded and best-effort. Safe workers suppress hooks, some automatic turns cannot be distinguished reliably, and cross-process deduplication, process-exit delivery and Android clear behavior are not guaranteed. Session IDs are disclosed to the ntfy server and client through deep links. The two tiers may produce overlapping alerts. Test actual request/resolve and closed-app behavior on your devices before relying on it.

To disable this tier, unsubscribe or mute its topic, disable the user plugin and remove only the startup and Serve configuration you created for it. Preserve unrelated services and credentials.

## Release startup compatibility

A historical release crash in AndroidX Startup was repaired by preserving Room generated database constructors through an Expo build-properties R8 rule. Keep the rule when regenerating Android. The historical cold-start check did not establish every notification delivery or action path.
