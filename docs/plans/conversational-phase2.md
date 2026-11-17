# Phase 2: conversation speech controls

The chat and voice sheet share one foreground speech player. A newer owner replaces the previous program; closing an older sheet cannot stop a newer program. Typed replies are silent and voice replies are spoken until the user explicitly changes **Speak replies**. An explicit choice applies to both input paths. Read aloud remains available when automatic speech is off. Typed playback has pause and stop controls in chat, and voice capture takes ownership of playback.

Automatic speech follows only the final completion correlated with a message submitted from this device. It does not read unsolicited desktop turns, steering, or command mutations. Speech uses the existing synthesis path and therefore follows the current configured service and its existing account and cost rules; this change does not create an account or add a provider.

**Type instead** cancels an unfinished recording, or appends a reviewed transcript to the existing draft without sending it. The transfer uses the same durable, idempotent checkpoint as shared drafts, preserves draft images, and permits retry on a save failure. If the app is interrupted before a failed save can be retried, the in-memory draft is not guaranteed to survive process termination.

Native microphone permissions, interruptions, playback controls, hands-free rearming, and draft recovery need on-device acceptance testing. This phase makes no latency or quality claim.

A no-inference empty speech-stream handshake was verified separately: it returned start metadata and an end frame without audio or text. Native streaming input/output remains conditional on a measured bottleneck and device acceptance.
