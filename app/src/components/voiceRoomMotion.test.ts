import { expect, it } from "vitest";
import { roomMotion, roomMotionSpec } from "./voiceRoomMotion";
it("selects distinct restrained room motions and honors reduced motion", () => {
  const activity = { phase: "speaking" as const, level: -20, threshold: -40, pauseProgress: 0 };
  expect(roomMotion("recording", null, false)).toBe("listening");
  expect(roomMotion("recording", activity, false)).toBe("hearing");
  expect(roomMotion("transcribing", null, false)).toBe("processing");
  expect(roomMotion("playing", null, false)).toBe("speaking");
  expect(roomMotion("paused", null, false)).toBe("still");
  expect(roomMotion("playing", null, true)).toBe("still");
  expect(roomMotionSpec.listening.duration).toBeGreaterThan(roomMotionSpec.hearing.duration);
  expect(roomMotionSpec.processing.rotation).toBeGreaterThan(0);
});
