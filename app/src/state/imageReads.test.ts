import { afterEach, expect, it, vi } from "vitest";
import { ImageReads } from "./imageReads";
afterEach(() => vi.useRealTimers());
it("shares concurrent loads and caches only within a bounded key space", async () => {
  const reads = new ImageReads(16),
    load = vi.fn(async () => "12345678");
  expect(
    await Promise.all(Array.from({ length: 5 }, () => reads.read("origin/session/a", load))),
  ).toEqual(Array(5).fill("12345678"));
  expect(load).toHaveBeenCalledTimes(1);
  await reads.read("origin/session/a", load);
  expect(load).toHaveBeenCalledTimes(1);
  await reads.read("origin/other/a", load);
  await reads.read("origin/session/a", load);
  expect(load).toHaveBeenCalledTimes(3);
  const large = vi.fn(async () => "a".repeat(20));
  await reads.read("large", large);
  await reads.read("large", large);
  expect(large).toHaveBeenCalledTimes(2);
  reads.clear();
});
it("one departing caller does not cancel another caller, but the last one aborts immediately", async () => {
  const reads = new ImageReads();
  let shared!: AbortSignal;
  const load = vi.fn(async (signal: AbortSignal) => {
    shared = signal;
    return new Promise<string>(() => {});
  });
  const a = new AbortController(),
    b = new AbortController();
  const first = reads.read("same", load, a.signal),
    second = reads.read("same", load, b.signal);
  const failed = Promise.all([
    expect(first).rejects.toThrow("cancelled"),
    expect(second).rejects.toThrow("cancelled"),
  ]);
  await Promise.resolve();
  a.abort();
  expect(shared.aborted).toBe(false);
  b.abort();
  expect(shared.aborted).toBe(true);
  await failed;
  expect(await reads.read("same", async () => "new")).toBe("new");
  reads.clear();
});
it("clear rejects pending callers even if a transport ignores AbortSignal and cannot cache its late reply", async () => {
  const reads = new ImageReads();
  let resolve!: (value: string) => void;
  const old = reads.read(
    "a",
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const rejection = expect(old).rejects.toThrow("cancelled");
  await Promise.resolve();
  reads.clear();
  await rejection;
  resolve("old");
  await Promise.resolve();
  await Promise.resolve();
  const load = vi.fn(async () => "fresh");
  expect(await reads.read("a", load)).toBe("fresh");
  expect(load).toHaveBeenCalledTimes(1);
  reads.clear();
});
it("does not fetch for an aborted caller and retries failures", async () => {
  const reads = new ImageReads(),
    controller = new AbortController();
  controller.abort();
  const load = vi.fn(async () => "x");
  await expect(reads.read("a", load, controller.signal)).rejects.toThrow("cancelled");
  expect(load).not.toHaveBeenCalled();
  await expect(
    reads.read("a", async () => {
      throw Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(await reads.read("a", load)).toBe("x");
  reads.clear();
});
it("times out a stalled read without waiting for an unresponsive adapter", async () => {
  vi.useFakeTimers();
  const reads = new ImageReads();
  const pending = reads.read("a", async () => new Promise(() => {}));
  const rejected = expect(pending).rejects.toThrow("cancelled");
  await vi.advanceTimersByTimeAsync(60_000);
  await rejected;
  reads.clear();
});
