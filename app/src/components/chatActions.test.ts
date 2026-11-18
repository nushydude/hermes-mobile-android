import { describe, expect, it } from "vitest";
import {
  appendQuote,
  findLoadedMessages,
  highlightParts,
  measuredSearchHop,
  nextMatchKey,
} from "./chatActions";

describe("quoting a message", () => {
  it("appends selected lines without replacing a draft or submitting anything", () => {
    expect(appendQuote("my draft", "first line\nsecond line\nthird", 0, 22)).toBe(
      "my draft\n\n> first line\n> second line\n\n",
    );
    expect(appendQuote("already\n", "hello", 0, 5)).toBe("already\n\n> hello\n\n");
    expect(appendQuote("already\n\n", "hello", 0, 5)).toBe("already\n\n> hello\n\n");
    expect(appendQuote("", "a\r\n\r\nb", 0, 6)).toBe("> a\n> \n> b\n\n");
    expect(appendQuote("", "  indented\n    code", 0, 19)).toBe(">   indented\n>     code\n\n");
  });
  it("ignores empty selections and does not split surrogate pairs", () => {
    expect(appendQuote("keep", "   ", 0, 3)).toBeNull();
    expect(appendQuote("keep", "hello", 3, 3)).toBeNull();
    expect(appendQuote("keep", "a😀b", 2, 2)).toBeNull();
    expect(appendQuote("", "a😀b", 2, 3)).toBe("> 😀\n\n");
    expect(appendQuote("", "a😀b", 1, 2)).toBe("> 😀\n\n");
    expect(appendQuote("", "abc", Number.NaN, 2)).toBeNull();
    expect(appendQuote("", "hello", 5, 0)).toBe("> hello\n\n");
  });
});

describe("search in loaded messages", () => {
  const rows = [
    { key: "row:8", index: 0, text: "Coffee at the Café" },
    { key: "row:9", index: 3, text: "Regex .* and 😀" },
    { key: "local:1", index: 5, text: "Another coffee" },
  ];
  it("matches case-insensitively, retains stable keys and original timeline positions", () => {
    expect(findLoadedMessages(rows, "cOFFee")).toEqual([
      { key: "row:8", index: 0 },
      { key: "local:1", index: 5 },
    ]);
    expect(findLoadedMessages(rows, "CAFÉ")).toEqual([{ key: "row:8", index: 0 }]);
    expect(findLoadedMessages(rows, "😀")).toEqual([{ key: "row:9", index: 3 }]);
    expect(findLoadedMessages(rows, "  ")).toEqual([]);
  });
  it("treats query punctuation literally and preserves full text when highlighting", () => {
    expect(findLoadedMessages(rows, ".*")).toEqual([{ key: "row:9", index: 3 }]);
    const text = "A .* B .* 😀";
    const parts = highlightParts(text, ".*");
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual([".*", ".*"]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(highlightParts("hello", "")).toEqual([{ text: "hello", match: false }]);
  });
  it("bounds highlight spans in pathological repeated text", () => {
    const text = "x ".repeat(500);
    const parts = highlightParts(text, "x");
    expect(parts.length).toBeLessThanOrEqual(201);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });
  it("cycles through stable matches and tolerates removed current rows", () => {
    const matches = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(nextMatchKey(matches, null, 1)).toBe("a");
    expect(nextMatchKey(matches, null, -1)).toBe("c");
    expect(nextMatchKey(matches, "c", 1)).toBe("a");
    expect(nextMatchKey(matches, "missing", -1)).toBe("c");
    expect(nextMatchKey([], null, 1)).toBeNull();
  });
  it("retries only measured frames, bounds attempts, and stops if measuring stalls", () => {
    let state = { attempts: 0, lastMeasured: -1, stagnant: 0 };
    const first = measuredSearchHop(state, { index: 80, highestMeasuredFrameIndex: 10 });
    expect(first).toMatchObject({ frame: 10, attempts: 1 });
    state = first!;
    state = measuredSearchHop(state, { index: 80, highestMeasuredFrameIndex: 10 })!;
    state = measuredSearchHop(state, { index: 80, highestMeasuredFrameIndex: 10 })!;
    expect(measuredSearchHop(state, { index: 80, highestMeasuredFrameIndex: 10 })).toBeNull();
    expect(
      measuredSearchHop(
        { attempts: 12, lastMeasured: 0, stagnant: 0 },
        { index: 80, highestMeasuredFrameIndex: 20 },
      ),
    ).toBeNull();
    expect(measuredSearchHop(state, { index: 10, highestMeasuredFrameIndex: 10 })).toBeNull();
    expect(measuredSearchHop(state, { index: 80, highestMeasuredFrameIndex: -1 })).toBeNull();
  });
});
