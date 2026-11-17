# Staged PC notification hook contract

The initial sections record source inspection and offline testing at the staging checkpoint, when
nothing had been installed or enabled. They do not establish running delivery or phone behavior.
The later activation observation records deployment to the running gateway. Current setup and
installation status are in [NOTIFICATIONS.md](../../NOTIFICATIONS.md) and [PC_SETUP.md](../../PC_SETUP.md).
Source examined: the local Hermes checkout on 16 November 2026 and the project's `PROTOCOL_CONTRACT.md`.

## Hooks and eligibility

`register(ctx)` registers `on_human_input_request`, `on_human_input_resolved`, `post_llm_call`, and `on_session_end` through `ctx.register_hook`. `tools/human_input_hooks.py` supplies `kind`, `request_id`, `session_id`, `session_key`, `platform`, redacted `prompt`, and on resolution `outcome`. The plugin does not transmit prompt, command, outcome, reply, history, or credentials. It requires a session ID, request ID, and kind approval, clarify, or sudo. It sends a generic message and on resolution queues a clear for the same sequence. Missing IDs are dropped.

`agent/turn_finalizer.py` calls `post_llm_call` **once after the tool loop**, not once per tool step, with `session_id`, `task_id`, `turn_id`, `user_message`, `assistant_response`, history, model, platform and token. It fires only when there is a final response and the turn is not interrupted. `on_session_end` carries `session_id`, `task_id`, `turn_id`, `completed`, `failed`, `interrupted`, `turn_exit_reason`, model and platform. This plugin emits successful notifications only when the two events pair by session and turn. A failed or interrupted end emits a generic ended notification even when the post hook never fired, unless an earlier post hook identified an explicit automatic slash form. End events without a recognized status are ignored. Duplicate keys are remembered only in bounded per-process memory, not across processes or restarts.

A literal `/loop` or `/heartbeat` user message is suppressed. The source also generates heartbeat prompts through `_run_prompt_submit` using an internal submission ID, but this ID/origin is not in these hook payloads (`tui_gateway/session_notifications.py`). The hook does not establish an origin flag for loop, heartbeat, background or subagent turns. The finalizer logs an agent `_turn_origin` for fork turns but does not include it in either hook. A session source cannot reliably identify the origin of an individual turn within that same session. Detached persistence-disabled forks suppress the inspected final hooks themselves, but not every possible automatic/subagent path is proven covered. Human-input hooks also lack turn origin, so their automatic-turn filtering cannot be guaranteed. Failures and interruptions without a post hook have no user message available for filtering; generic notifications may therefore be noisy; live origin characterization is required before claiming the requested noise filter is complete.

## Transport and privacy

The worker reads JSON from `HERMES_MOBILE_NOTIFY_CONFIG`, or `plugins/phone-notify/config.json` under `HERMES_HOME` (the default Hermes home if unset). `prepare-runtime.py` writes `.artifacts/notifications/plugin-config.json`; explicitly set the gateway process environment override to that path or securely copy it to the default location. Format: `{"publish_url":"http://127.0.0.1:9130","topic":"...","token":"..."}`. The token is an optional ntfy bearer credential. `publish_url` is an origin without path, query or userinfo; only loopback HTTP or `*.ts.net` HTTPS is accepted. The phone subscription must use the separate HTTPS Tailscale Serve endpoint. No config, URL, topic, token, prompt or payload is logged. Notifications contain only a generic title/body and `hermesmobile://session/<percent-encoded-session-id>` click URI. Session IDs are consequently disclosed to the ntfy server and phone. Configure private file permissions and private ntfy topic access separately.

Hooks enqueue without network or config I/O; the bounded queue drops new events when full. The daemon worker makes one attempt with a three-second timeout, does not follow redirects or retry, and silently drops failures. Shutdown does not wait for delivery; there is no durable queue or guarantee of delivery. Bounded state evictions and process boundaries can prevent deduplication or resolution clears. Requests dropped before enqueue never create a clear. The plugin reads current configuration per delivery.

For a request, a deterministic, opaque sequence ID is sent as `X-Sequence-ID`; on resolution the worker sends `PUT /<topic>/<sequence_id>/clear`. The current [ntfy publishing documentation](https://docs.ntfy.sh/publish/#clearing-notifications) specifies this emits `message_clear` to mark read and dismiss Android notifications. Merely reusing a message ID updates a notification; it does not by itself establish cancellation. The provisioned server version, Android client, offline/reconnect behavior, click handling, and authentication on clear remain unverified. No cancellation is claimed until exercised. A compatible clear endpoint is required; older installations may leave a delivered alert visible. The separate in-app Tier 1 notification handling is independent.

## Worker loading and remaining work

`hermes_cli/plugins.py` documents lazy discovery on first hook delivery in processes including TUI slash workers; `agent/safe_worker_policy.py` says ordinary managed workers load plugins and hooks with their frozen session config. The same lifecycle dispatcher explicitly suppresses plugin hooks in safe workers; outbound webhooks are also suppressed in safe workers (`hermes_cli/lifecycle.py`, `agent/outbound_webhooks.py`). Source therefore supports trying the plugin in ordinary workers, but does not prove desktop execution and profile enablement in this installation. No relay or config patch is staged because a coverage failure has not been observed and outbound hooks do not solve safe-worker suppression. If a regular worker fails to load the plugin, inspect its frozen config and discovery first; a relay plus a `hooks.outbound` entry would need separate design and review, because outbound payloads contain more sensitive raw hook fields and require sanitization before ntfy.

Before deployment, review plugin and limitations; provisioning, installation, enabling and any restart are separate owner-controlled actions. Required live checks include desktop-origin ordinary managed-worker hooks, request/resolve pairing, notification clear on the actual ntfy versions, HTTPS subscription and encoded deep-link, privacy, automatic turn noise, and duplicate/loss behavior. No production hook or device was exercised by these tests.

## Subsequent main-agent observations

After source review, main installed/enabled the user plugin and backed up config.yaml first.
The actual CLI hot-reloaded hooks into the running gateway; no gateway restart was needed.
A PC-only own GUI session completed a no-tools prompt, and its generic completion notification
with its encoded session click link was observed via the real Tailscale HTTPS ntfy API. The own
session was archived. This demonstrates ordinary GUI-worker loading/delivery in this installation;
it is not real Desktop UI or Android notification proof. Private ntfy 2.38.0 authorization checks,
publish/read and sequence-clear HTTP endpoint checks passed. Actual Android dismissal and real
Hermes human-input request/resolve delivery remain unverified. The source and best-effort delivery
limitations above still apply; one successful turn does not guarantee delivery for every worker.
