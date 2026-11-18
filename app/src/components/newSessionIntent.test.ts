import { expect, it, vi } from "vitest";
import {
  reserveVoiceEntry,
  targetVoiceEntry,
  cancelVoiceEntry,
  consumeVoiceEntry,
  subscribeVoiceEntry,
} from "./newSessionIntent";
it("the exact endpoint, revision and session consumes an intent only once", () => {
  const changed = vi.fn(),
    unsubscribe = subscribeVoiceEntry(changed);
  const token = reserveVoiceEntry(4, "origin");
  targetVoiceEntry(token, "target", 9);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(consumeVoiceEntry(4, "origin", "target", 9)).toBe(true);
  expect(consumeVoiceEntry(4, "origin", "target", 9)).toBe(false);
  unsubscribe();
});
it("stale same-session subscribers cannot erase or consume a newer destination", () => {
  const token = reserveVoiceEntry(1, "a");
  const unsub = subscribeVoiceEntry(() => {
    expect(consumeVoiceEntry(1, "a", "same", 2)).toBe(false);
  });
  targetVoiceEntry(token, "same", 4);
  expect(consumeVoiceEntry(1, "a", "same", 4)).toBe(true);
  unsub();
});
it("older reservations cannot replace a newer reservation", () => {
  const old = reserveVoiceEntry(1, "a"),
    next = reserveVoiceEntry(1, "a");
  targetVoiceEntry(old, "wrong", 1);
  cancelVoiceEntry(old);
  targetVoiceEntry(next, "right", 1);
  expect(consumeVoiceEntry(1, "a", "right", 1)).toBe(true);
});
