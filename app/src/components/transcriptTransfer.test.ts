import { describe, expect, it, vi } from "vitest";
import { TranscriptTransfer } from "./transcriptTransfer";
describe("transcript transfer ownership", () => {
  it("synchronously blocks late editor callbacks and protects newer text at completion", () => {
    const t = new TranscriptTransfer(),
      apply = vi.fn();
    let text = "before";
    const work = t.begin(text, () => "id")!;
    expect(t.canLeave()).toBe(false);
    expect(t.edit("late", apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    text = "changed externally";
    expect(t.finish(work.token, text)).toBe("changed");
    expect(t.canLeave()).toBe(true);
    expect(t.edit("revised", apply)).toBe(true);
    expect(t.begin("revised", () => "new")).toBeNull();
  });
  it("retries same captured transfer, rejects duplicates and stale completions", () => {
    const t = new TranscriptTransfer(),
      id = vi.fn(() => "stable");
    const one = t.begin("words", id)!;
    expect(t.begin("words", id)).toBeNull();
    expect(t.fail(one.token)).toBe(true);
    const two = t.begin("words", id)!;
    expect(two.id).toBe(one.id);
    expect(id).toHaveBeenCalledTimes(1);
    expect(t.finish(one.token, "words")).toBe("stale");
    expect(t.fail(one.token)).toBe(false);
    expect(t.canLeave()).toBe(false);
    expect(t.finish(two.token, "words")).toBe("saved");
    expect(t.canLeave()).toBe(true);
    expect(t.finish(two.token, "words")).toBe("stale");
  });
});

it("rejects oversized transcripts before acquiring ownership so they remain editable", () => {
  const t = new TranscriptTransfer(),
    id = vi.fn(() => "id"),
    apply = vi.fn();
  expect(t.begin("x".repeat(100001), id)).toBeNull();
  expect(id).not.toHaveBeenCalled();
  expect(t.canLeave()).toBe(true);
  expect(t.edit("shorter", apply)).toBe(true);
});
it("recovers ambiguous failure only after successful copy and never starts another import", async () => {
  const t = new TranscriptTransfer(),
    id = vi.fn(() => "stable"),
    work = t.begin("words", id)!;
  expect(t.fail(work.token)).toBe(true);
  expect(
    await t.recover(
      "words",
      async () => false,
      () => true,
      () => "words",
    ),
  ).toBe(false);
  expect(t.canLeave()).toBe(false);
  let resolve!: (value: boolean) => void;
  const pending = new Promise<boolean>((r) => {
    resolve = r;
  });
  const copying = t.recover(
    "words",
    () => pending,
    () => true,
    () => "words",
  );
  expect(t.begin("words", id)).toBeNull();
  expect(t.canLeave()).toBe(false);
  resolve(true);
  expect(await copying).toBe(true);
  expect(t.canLeave()).toBe(true);
  expect(id).toHaveBeenCalledTimes(1);
});
it("recovers a saved older snapshot without reimporting changed review text", async () => {
  const t = new TranscriptTransfer(),
    work = t.begin("old", () => "first")!;
  expect(t.finish(work.token, "new")).toBe("changed");
  expect(t.edit("newer", () => {})).toBe(true);
  expect(t.begin("newer", () => "second")).toBeNull();
  expect(
    await t.recover(
      "newer",
      async () => true,
      () => true,
      () => "newer",
    ),
  ).toBe(true);
  expect(t.canLeave()).toBe(true);
});
it("keeps review on copy failure, stale scope or changed text", async () => {
  for (const mode of ["throws", "scope", "changed"] as const) {
    const t = new TranscriptTransfer(),
      work = t.begin("words", () => "id")!;
    t.fail(work.token);
    const copy = async () => {
      if (mode === "throws") throw Error("clipboard");
      return true;
    };
    expect(
      await t.recover(
        "words",
        copy,
        () => mode !== "scope",
        () => (mode === "changed" ? "new" : "words"),
      ),
    ).toBe(false);
    expect(t.canLeave()).toBe(false);
    expect(t.canRecover()).toBe(true);
  }
});
