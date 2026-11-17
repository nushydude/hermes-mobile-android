> SUPERSEDED: historical draft only. Follow [PLAN.md](PLAN.md), [the verified protocol](PROTOCOL_CONTRACT.md) and [accepted ADRs](docs/adr/README.md). Its ticket bridge, cleartext and platform/protocol assumptions must not guide implementation.

\# Task: Build React Native (Expo) Mobile Client for Hermes Agent (Gateway WebSocket)



\## 1. Objective

Build a native Android/iOS mobile application using \*\*React Native (Expo + TypeScript)\*\* that connects remotely over \*\*Tailscale\*\* to a self-hosted \*\*Hermes Agent\*\* running on this desktop PC via Hermes's canonical \*\*Gateway WebSocket (`/api/ws`, protocol `hermes-gateway-v1`)\*\*.



The app must support creating new sessions, listing/switching existing PC/mobile sessions, streaming responses with collapsible tool-call/thinking blocks, slash commands, and interactive server→client approval cards.



\---



\## 2. Execution Rules \& Two-Phase Gate (CRITICAL)

Do \*\*NOT\*\* scaffold the React Native / Expo app until \*\*Phase 1\*\* is complete and verified against the local Hermes installation.



\### Phase 1: Local Discovery, Auth/Ticket Bridge \& Protocol Verification

1\. \*\*Locate Installed Hermes Source \& TypeScript Contracts:\*\*

&#x20;  - Locate both `\~/.hermes` and the installed Hermes codebase/package (`which hermes`, `ps aux | grep hermes`, or Python `site-packages`).

&#x20;  - Inspect `tui\_gateway/ws.py`, `tui\_gateway/contracts/canonical\*.py`, and `apps/shared` (`@hermes/shared/gateway-client` and generated `RpcMethods` TypeScript types).

2\. \*\*Audit Local Node \& Android Build Environment:\*\*

&#x20;  - Check `node -v`, `npm`/`pnpm`/`yarn`, `ANDROID\_HOME` / `ANDROID\_SDK\_ROOT`, `java -version`, and `adb devices`.

3\. \*\*Solve Remote Tailscale Auth \& Write `PROTOCOL\_CONTRACT.md`:\*\*

&#x20;  - Inspect how `/api/ws` authenticates connections (`hermes-gateway-v1` + `hermes-gateway-ticket.<ticket>` subprotocols, loopback checks, and `Origin` header rules).

&#x20;  - Because the Android phone connects remotely over Tailscale (`100.x.y.z`) and cannot dial the PC's local Unix control socket directly:

&#x20;    - Configure `tailscale serve` (preferred, gives `wss://` with valid TLS) OR configure a minimal authenticated PC-side bridge/helper (secured via Tailscale identity or bearer token) that mints short-lived `session-ticket` tokens via `hermes gateway attach` / the control socket for the mobile client.

&#x20;  - Write `./hermes-mobile-rn/PROTOCOL\_CONTRACT.md` documenting the exact verified auth/ticket flow, JSON-RPC methods, streaming events, and approval payloads.

&#x20;  - Run a small standalone Node/TypeScript smoke test script against the local Hermes WebSocket confirming: `ticket mint -> ws handshake -> gateway.ready -> client.capabilities -> session.create -> prompt.submit -> streaming delta -> session.list`.



\### Phase 2: React Native (Expo) Application Implementation



\#### A. Tech Stack \& Architecture

\- \*\*Framework:\*\* Expo (TypeScript) with \*\*Expo Router\*\* (or React Navigation) and \*\*Development Build (`npx expo prebuild` / `expo-dev-client`)\*\* — do NOT rely on Expo Go since native secure storage and custom network security config are required.

\- \*\*State \& Connection Ownership:\*\*

&#x20; - Keep the WebSocket client (`HermesGatewayClient`) in a module-level singleton store (\*\*Zustand\*\*), decoupled from React screen mounts/unmounts so navigation or brief backgrounding does not drop active streams.

&#x20; - Reuse or mirror Hermes's TypeScript `RpcMethods` types directly.

\- \*\*Networking \& Resilience:\*\*

&#x20; - React Native's built-in `WebSocket` supporting the subprotocol array `\["hermes-gateway-v1", "hermes-gateway-ticket.<ticket>"]` (Note: ensure no forbidden `Origin` header breaks Hermes's handshake check).

&#x20; - Application-level JSON-RPC heartbeat ping + exponential backoff auto-reconnect that fetches a fresh single-use ticket on every reconnect attempt.

\- \*\*Security \& Cleartext Handling:\*\*

&#x20; - Store Tailscale host, port, scheme (`wss://` vs `ws://`), and bridge/gateway auth token in \*\*`expo-secure-store`\*\*.

&#x20; - Configure \*\*`expo-build-properties`\*\* in `app.json` (`android.usesCleartextTraffic: true` for debug/tailnet IP access) alongside `tailscale serve` (`wss://`) instructions—do \*\*NOT\*\* use invalid CIDR notation in Android network security XML.



\#### B. Core Functional Requirements

1\. \*\*Connection \& Settings Screen:\*\*

&#x20;  - Configure Tailscale Host (`100.x.y.z` or MagicDNS hostname), Port, Scheme (`wss://` / `ws://`), and Auth Token.

&#x20;  - "Test Connection" button + live status indicator (`Disconnected`, `Connecting`, `Connected`, `Reconnecting`).

2\. \*\*Multi-Session Drawer (Full Desktop Parity):\*\*

&#x20;  - \*\*New Session:\*\* One-tap `+` button calling `session.create` (with optional model override).

&#x20;  - \*\*Session List \& Switching:\*\* Populate drawer from `session.list` sorted by recent activity; tapping loads history (`session.history`) and attaches live updates.

&#x20;  - \*\*Session Actions:\*\* Rename title (`session.mutate` with `expected\_revision` + `operation: "rename"`) and archive (`operation: "archive"`).

3\. \*\*Chat, Streaming \& Tool Telemetry:\*\*

&#x20;  - Render Markdown (`react-native-markdown-display` or equivalent) with syntax-highlighted code blocks and one-tap copy.

&#x20;  - Stream assistant token deltas smoothly (throttle/batch UI state updates at \~30–60ms intervals so React Native JS thread never bottlenecks on fast token streams).

&#x20;  - Render collapsible accordion cards for \*\*Thinking/Reasoning\*\* and \*\*Tool Executions\*\* (tool name, args, live spinner, and output).

&#x20;  - Support slash commands (`/new`, `/model`, `/stop`, `/compact`) and mid-run steering (`session.steer`).

4\. \*\*Interactive Server→Client Approvals:\*\*

&#x20;  - Advertise `client.capabilities` with `{"server\_requests": true}` immediately after `gateway.ready`.

&#x20;  - Render interactive approval / `clarify` cards when Hermes sends a server→client request, and send back the JSON-RPC response on tap.

&#x20;  - Automatically dismiss the card if the server emits `request.cancel`.

&#x20;  - Immediately return JSON-RPC error `-32601` (`Method not found`) for any unhandled server→client request method so Hermes never deadlocks.

5\. \*\*Mobile Lifecycle \& Lock-Screen Recovery:\*\*

&#x20;  - Listen to React Native `AppState` (`active` / `background`). When returning to `active` or after a socket reconnect, mint a new ticket, reconnect, re-attach to the active `session\_id`, and sync `session.history` so tokens generated while locked appear cleanly.



\---



\## 3. Deliverables \& Acceptance Criteria

1\. `./hermes-mobile-rn/PROTOCOL\_CONTRACT.md` (verified against this machine's installed Hermes code).

2\. Complete Expo TypeScript project in `./hermes-mobile-rn/` with unit tests (Jest/Vitest) covering JSON-RPC correlation, ticket refresh on reconnect, and `-32601` fallback.

3\. Clean Android debug APK build verified via `npx expo prebuild --platform android` and `./android/gradlew assembleDebug` (or `npx expo run:android`).

4\. `./hermes-mobile-rn/PC\_SETUP.md` documenting the exact PC-side Tailscale / ticket-bridge setup and how to install the APK on Android.
