# Conversation reliability acceptance

This is an owner phone acceptance checklist for the forthcoming preview, not evidence that these device flows passed. Host regression tests exercise scoped ownership, persistence, exact reply correlation and task-state transitions using fake adapters.

| Journey | Expected result |
| --- | --- |
| Type with Speak replies off/on | Same canonical session; only this device's matching successful final reply is spoken when enabled. |
| Record with Speak replies off/on | Review first remains available; output choice does not change the submitted words or session. |
| Stop or mute an active hands-free reply | Speech stops; listening stays paused until explicit Resume. Agent work is independent. |
| Type instead after transcript review | Append once to draft, retain images, send only after review. Failed storage leaves retryable text. |
| End voice during recording/transcription | Release local resources, retain accepted work; no automatic later send. |
| Navigate, lock, background, change gateway | Release local microphone/playback; no stale completion speaks or sends in another scope. |
| Call, headset unplug, Bluetooth change | Audio obeys Android routing/focus; no unintended recording. Owner must test actual hardware. |
| Fast/Balanced/Deep | Existing allowed subscription route, same session, effective settings shown; unavailable mappings disabled. |
| Child completes/disappears/restarts | Explicit terminal evidence drives completion; missing unfinished child is Unknown. Never auto-relaunch. |
| Stop one child | Request only that child to stop; parent and unrelated children continue. |
| Notification replay/reconnect | A known terminal child notification is deduplicated; open the parent for canonical history. |
| Large text and TalkBack | Main actions wrap/read clearly, Stop and Type instead remain reachable, disabled controls announced. |
| Sharing, Find, quote, offline draft, approvals | Existing behavior remains usable; no draft loss or approval bypass. |

Do not run model/audio benchmarks until the selected existing provider route and permitted resource/cost budget are verified. No measured speed improvement is claimed by this preview. Native duplex/streaming adapters remain gated; complete-file audio remains the supported implementation. Diagnostic timings are opt-in and bounded, and contain no transcript/session/credential data. No new paid plan or API-account connection is needed for the implemented existing-pipeline controls.

The current Expo Android player requests transient focus for the `doNotMix` mode, pauses for focus loss and may resume after a transient interruption. Its recorder path does not itself request audio focus; setting the mode for capture is not proof of microphone interruption handling. On a phone, check incoming calls, transient focus return, headset and Bluetooth changes, and whether manual pause/Stop prevents unwanted resumption. Verify recording and hands-free state separately; these cases have not been accepted on hardware.
