import { expect, it, vi } from "vitest";
import { queueVoiceAudioMode } from "./voiceAudioMode";
it("serializes a cancelled playback mode before a newer capture mode", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((r) => {
    resolve = r;
  });
  let valid = true;
  const set = vi
    .fn()
    .mockImplementationOnce(() => pending)
    .mockResolvedValue(undefined);
  const old = queueVoiceAudioMode(set, false, () => valid);
  await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  valid = false;
  const next = queueVoiceAudioMode(set, true, () => true);
  expect(set).toHaveBeenCalledTimes(1);
  const rejected = expect(old).rejects.toThrow("Cancelled");
  resolve();
  await rejected;
  await next;
  expect(set.mock.calls.map((call) => call[0].allowsRecording)).toEqual([false, true]);
});
