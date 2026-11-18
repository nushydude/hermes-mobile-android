/** Foreground file-based voice uses the same interruption mode for capture and playback. */
export const voiceAudioMode = (allowsRecording: boolean) => ({
  allowsRecording,
  shouldPlayInBackground: false,
  interruptionMode: "doNotMix" as const,
});

// Native audio mode changes can complete after cancellation. Serialize every change
// so a stale playback transition cannot overwrite a later capture transition.
let modeQueue: Promise<void> = Promise.resolve();
export function queueVoiceAudioMode(
  setMode: (mode: ReturnType<typeof voiceAudioMode>) => Promise<void>,
  recording: boolean,
  valid: () => boolean,
): Promise<void> {
  const work = modeQueue
    .catch(() => {})
    .then(async () => {
      if (!valid()) throw new Error("Cancelled");
      await setMode(voiceAudioMode(recording));
      if (!valid()) throw new Error("Cancelled");
    });
  modeQueue = work.catch(() => {});
  return work;
}

let cleanupBarrier: Promise<void> = Promise.resolve();
export function registerVoiceCleanup(cleanup: Promise<void>) {
  cleanupBarrier = Promise.all([cleanupBarrier.catch(() => {}), cleanup.catch(() => {})]).then(
    () => {},
  );
}
export function waitVoiceCleanup() {
  return cleanupBarrier;
}
