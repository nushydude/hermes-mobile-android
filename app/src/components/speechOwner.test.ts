import { describe, expect, it, vi } from "vitest";
import { SpeechOwner } from "./speechOwner";
import { VoicePlayback } from "./voicePlayback";
import { TypedSpeechWatcher } from "./typedSpeechWatcher";

describe("shared speech ownership", () => {
  it("old lease cleanup cannot stop or control a new owner", () => {
    const playback = new VoicePlayback({ acquire: vi.fn() });
    const stop = vi.spyOn(playback, "stop");
    const owner = new SpeechOwner(playback);
    const old = owner.acquire(),
      next = owner.acquire();
    const calls = stop.mock.calls.length;
    old.stop();
    old.release();
    old.toggle();
    expect(stop).toHaveBeenCalledTimes(calls);
    expect(next.owns()).toBe(true);
    next.release();
    expect(stop).toHaveBeenCalledTimes(calls + 1);
  });
});
describe("typed speech watcher", () => {
  it("buffers early completion and ignores foreign and duplicate events", () => {
    const speak = vi.fn(),
      watch = new TypedSpeechWatcher(
        "a",
        () => undefined,
        () => true,
        speak,
      );
    const event = (session_id: string, id: string, text: string) => ({
      type: "message.complete",
      session_id,
      payload: { status: "complete", text, persisted_turn: { submission_id: id } },
    });
    watch.event(event("b", "mine", "foreign"));
    watch.event(event("a", "other", "other"));
    watch.event(event("a", "mine", "mine"));
    watch.bind("mine");
    watch.event(event("a", "mine", "duplicate"));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith("mine");
  });
  it("uses late admission mapping and suppresses a stale scope or closed watcher", () => {
    let admission: string | undefined,
      valid = false;
    const speak = vi.fn(),
      watch = new TypedSpeechWatcher(
        "a",
        () => admission,
        () => valid,
        speak,
      );
    watch.bind("mine");
    watch.event({
      type: "message.complete",
      session_id: "a",
      admission_id: "server",
      payload: { status: "complete", text: "done" },
    });
    admission = "server";
    watch.refresh();
    valid = true;
    watch.refresh();
    expect(speak).not.toHaveBeenCalled();
    const closed = new TypedSpeechWatcher(
      "a",
      () => undefined,
      () => true,
      speak,
    );
    closed.close();
    closed.event({
      type: "message.complete",
      session_id: "a",
      payload: { status: "complete", text: "done", persisted_turn: { submission_id: "id" } },
    });
    closed.bind("id");
    expect(speak).not.toHaveBeenCalled();
  });
});

it("revoking a lease invalidates a pending controller permission before capture", async () => {
  const { voiceLeaseValid } = await import("./speechOwner");
  const { VoiceController } = await import("./voiceController");
  let resolve!: (v: boolean) => void;
  const permission = new Promise<boolean>((r) => {
    resolve = r;
  });
  const owner = new SpeechOwner(new VoicePlayback({ acquire: vi.fn() })),
    old = owner.acquire(),
    start = vi.fn();
  const controller = new VoiceController({
    valid: () => voiceLeaseValid(old, () => true),
    cancelPendingReply: vi.fn(),
    permission: () => permission,
    prepare: vi.fn(async () => {}),
    start,
    stop: vi.fn(async () => null),
    discard: vi.fn(async () => {}),
    transcribe: vi.fn(async () => ""),
    send: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    stopPlayback: old.stop,
  });
  const work = controller.start();
  await Promise.resolve();
  owner.acquire();
  resolve(true);
  await work;
  expect(start).not.toHaveBeenCalled();
  controller.end();
  owner.dispose();
});

it("revoking a lease ignores a pending transcription from the old voice owner", async () => {
  const { voiceLeaseValid } = await import("./speechOwner");
  const { VoiceController } = await import("./voiceController");
  let resolve!: (v: string) => void;
  const transcription = new Promise<string>((r) => {
    resolve = r;
  });
  const owner = new SpeechOwner(new VoicePlayback({ acquire: vi.fn() })),
    old = owner.acquire(),
    transcribe = vi.fn(() => transcription);
  const controller = new VoiceController({
    valid: () => voiceLeaseValid(old, () => true),
    cancelPendingReply: vi.fn(),
    permission: vi.fn(async () => true),
    prepare: vi.fn(async () => {}),
    start: vi.fn(),
    stop: vi.fn(async () => "file"),
    discard: vi.fn(async () => {}),
    transcribe,
    send: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    stopPlayback: old.stop,
  });
  await controller.start();
  const work = controller.stop();
  await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
  owner.acquire();
  resolve("stale");
  await work;
  expect(controller.getState().text).toBe("");
  controller.end();
  owner.dispose();
});
