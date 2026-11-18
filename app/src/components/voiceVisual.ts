import type { VadFeedback } from "./voiceActivity";
// Only speech above the calibrated threshold drives the orb; this is visual feedback, not VAD.
export function voiceVisualLevel(previous: number, activity: VadFeedback | null): number {
  const target =
    activity && (activity.phase === "speaking" || activity.phase === "pause")
      ? Math.max(0, Math.min(1, (activity.level - activity.threshold) / 24))
      : 0;
  return previous * 0.75 + target * 0.25;
}
