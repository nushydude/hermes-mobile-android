# Hands-free v2 — multimodal full-screen room

Approved by the owner on 18 November 2026. Reference for the [implementation plan](../../plans/2026-11-18-fullscreen-handsfree.md).

Open [preview.html](preview.html) directly for the core synthetic interactions. Editable source: [preview.fragment.html](preview.fragment.html). The preview uses no microphone, network, real attachment or session API. Select a camera/image option to demonstrate a sample image; explicit Send is required. Optional host design controls are inert outside the visualization host. Native icons should use the existing Ionicons library; standalone character fallbacks illustrate placement only.

Tap the waveform icon in the normal composer to enter voice. Both composer and voice room retain a + attachment/camera control. In voice, opening the picker pauses capture; the sample attachment is retained until Send/remove. A new-conversation icon opens confirmation, preserves the old chat and enters a new voice session directly. End also has confirmation and no outside-tap dismissal. Pause/Resume and tap-to-interrupt remain distinct from stopping agent work.

The animation is calm at a quiet baseline. Motion and the Listening/Thinking/Speaking/Paused labels are illustrative state feedback, not proof of speech recognition, latency or hardware behavior. Actual detection uses calibrated microphone evidence and requires separate noise acceptance. Respect reduced motion and preserve action reachability at large text sizes.

Saved state images are exported from this same source revision. They are design references, not Android runtime screenshots. Refer to the plan for lifecycle, accessibility, creation-uncertainty, attachment and review requirements.

- [Normal composer and voice entry](chat.png)
- [Listening](listening.png)
- [Paused attachment review](attachment.png)
- [Protected new-conversation confirmation](new-conversation.png)
- [Speaking](speaking.png)
- [Paused](paused.png)
