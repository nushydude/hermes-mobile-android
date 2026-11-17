# ADR 0006: Continuity-first foreground voice

- **Status:** Accepted
- **Decision date:** 16 November 2026; hands-free authorized 17 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The owner wants to speak within the same session and keep its selected model and reasoning settings.
The gateway's audio routes were initially source research, so the owner required an audio smoke before
app changes. The initial plan excluded voice; the owner subsequently authorized this follow-up and
later authorized opt-in hands-free operation.

## Decision

In an existing chat, capture foreground audio, use the gateway's transcription route, submit the
result through the ordinary durable text outbox, then speak only the matching completed reply through
the gateway speech route. Retain Review first, editable transcript and explicit Send. Hands-free adds
local room calibration and speech/pause detection, an explicit Finish speaking fallback, and re-arms
only after the matching reply finishes speaking naturally and a cooldown. Errors, missing metering,
requests, backgrounding and connection gaps stop or pause the loop.

Use one recorder metering stream for feedback and detection. Preserve the typed draft and session
model/reasoning; do not use `voice_turn` or `voice_context` to silently select auxiliary settings.
Never infer an approval from voice. Ending voice stops local audio, not already accepted Hermes work.

## Alternatives

Speaking provisional deltas was rejected: they can be interim commentary before further tool work,
and the inspected stream has no immutable final-sentence signal. A live voice integration that does
not preserve every spoken exchange canonically cannot yet satisfy the continuity requirement.

## Consequences

This is a turn-based transcription/text/speech pipeline, not a native real-time voice model or live
transcript. Full model/tool execution still happens before reply speech begins. No background
microphone service was added. Talking during initial calibration can mask initial speech; sudden
noise can resemble speech. Actual phone acoustics, Bluetooth routing, interruptions and hands-free
reliability require owner testing.

## Evidence

The successful Tailscale audio and same-session smoke, as well as the first synthetic recognition
failure, are recorded in [PROTOCOL_CONTRACT.md](../../PROTOCOL_CONTRACT.md). Design and safety
constraints are in [the hands-free design](../designs/handsfree-v1/DESIGN.md). PC-side timings are
not phone latency guarantees.
