# Voice refinement v2

Owner authorized this batch after the independent codebase cleanup: cleaner spoken prose,
playback controls and a friendlier voice panel. Keep the approved Warm forest palette and shapes.
This is a refinement of existing-session voice, not a new chat or model route.

## Presentation

- Retain the chat title and quieter current model/reasoning metadata throughout voice.
- Use a generous central 96–112 dp round microphone/stop control with restrained animated emphasis.
  Ready, Recording, Transcribing, Waiting for Hermes, Speaking and Paused have distinct honest labels.
- Show actual elapsed recording time against the existing 60 second limit. Decorative motion must
  not claim to measure speech; respect reduced motion and stop animation on teardown.
- Review remains an editable transcript with explicit Send. Preserve keyboard avoidance, safe area,
  text scaling, request warning/Return to chat, storage/delivery errors and End voice.
- During playback expose Pause/Resume, Replay reply, Back 10 seconds and speed 0.8x/1x/1.25x/1.5x.
  Use at least 48 dp targets and descriptive accessibility labels. Display real current-part time and
  duration when available, plus Part N of M for longer replies; never fake total duration.
- End voice ends local capture/playback only. Existing Stop task and approval/clarify remain separate.
- `preview.png` is an illustrative layout, not a phone screenshot or native acceptance result.

## Audio behavior

- Format assistant Markdown for speech only: spoken prose and link labels, code-block/image
  placeholders, no long raw URLs or markup. Keep the original canonical text/history unchanged.
  Never apply assistant formatting to the user's transcript or durable submission.
- Replace the 4,000 character cutoff with bounded complete sections. Split at natural boundaries,
  avoid splitting surrogate pairs, and synthesize lazily via the existing authenticated speak API.
  At most a small bounded number of audio files should be retained; cancel/delete owned resources
  on End/background/navigation/endpoint change. Stop during late synthesis must not start audio.
- Playback controls operate on the current voice session. Speed applies across its parts/replays.
  Replay restarts the reply. Rewind crosses known earlier parts when needed; clamp at the start.
  If a control is unavailable during audio preparation, disable it honestly; End remains available.
- Handle pause during playback and late callbacks without starting a newer part or deleting newer
  resources. Pause must not expire merely because the user left playback paused. Network/load work
  remains bounded. Failures offer an explicit retry/read-in-chat fallback, without rerunning Hermes.
- Keep exact submission/admission identity for automatic readback and all existing generation/epoch
  fences. Foreground-only capture, explicit review/send and chosen model/reasoning remain unchanged.

No hands-free listening, automatic send, streamed LLM output, new provider/account, gateway change,
background microphone or device tests are included. Main performs host verification/native build;
independent Sol reviews actual code/tests and this reference. Owner accepts native behavior later.
