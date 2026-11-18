import { expect, it } from "vitest";
import { VoiceEntryTransaction } from "./voiceEntryTransaction";
import { consumeVoiceEntry } from "./newSessionIntent";
it("does not publish after a pending source navigation leaves and returns", () => {
  let scope = { epoch: 1, origin: "a", revision: 0, session: null as string | null };
  const tx = new VoiceEntryTransaction(1, "a", () => scope);
  scope = { ...scope, revision: 1, session: "B" };
  scope = { ...scope, revision: 2, session: null };
  expect(tx.owns()).toBe(false);
  expect(tx.publish("B")).toBe(false);
  expect(consumeVoiceEntry(1, "a", "B", 2)).toBe(false);
});
it("adopts its own activation and refuses an endpoint ABA", () => {
  let scope = { epoch: 1, origin: "a", revision: 1, session: null as string | null };
  const tx = new VoiceEntryTransaction(1, "a", () => scope);
  scope = { ...scope, revision: 2, session: "B" };
  tx.activated(2);
  expect(tx.publish("B")).toBe(true);
  expect(consumeVoiceEntry(1, "a", "B", 2)).toBe(true);
  const stale = new VoiceEntryTransaction(1, "a", () => scope);
  scope = { ...scope, epoch: 2, origin: "b" };
  scope = { ...scope, epoch: 3, origin: "a" };
  expect(stale.owns()).toBe(false);
  stale.cancel();
});
