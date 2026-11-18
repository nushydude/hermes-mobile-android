import type { VoicePhase } from "./voiceController";
import type { VadFeedback } from "./voiceActivity";
export type RoomMotion = "still" | "listening" | "hearing" | "processing" | "speaking";
export function roomMotion(
  phase: VoicePhase,
  activity: VadFeedback | null,
  reduceMotion: boolean,
): RoomMotion {
  if (reduceMotion || phase === "paused" || phase === "idle" || phase === "error") return "still";
  if (phase === "playing") return "speaking";
  if (phase === "recording")
    return activity?.phase === "speaking" || activity?.phase === "pause" ? "hearing" : "listening";
  return "processing";
}
export const roomMotionSpec: Record<
  RoomMotion,
  { duration: number; scale: number; rotation: number }
> = {
  still: { duration: 0, scale: 0, rotation: 0 },
  listening: { duration: 2000, scale: 0.025, rotation: 0 },
  hearing: { duration: 900, scale: 0.045, rotation: 0 },
  processing: { duration: 4000, scale: 0.015, rotation: 8 },
  speaking: { duration: 1400, scale: 0.04, rotation: 0 },
};
