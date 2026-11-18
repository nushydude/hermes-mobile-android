import { expect, it } from "vitest";
import { composerActions } from "./composerActions";
it("shows voice at rest and adds send for text or images", () => {
  expect(composerActions("  ", 0)).toEqual({ showSend: false, showVoice: true });
  expect(composerActions("hello", 0)).toEqual({ showSend: true, showVoice: true });
  expect(composerActions("", 1)).toEqual({ showSend: true, showVoice: true });
});
