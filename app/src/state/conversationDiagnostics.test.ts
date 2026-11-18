import { describe, expect, it } from "vitest";
import { ConversationDiagnostics } from "./conversationDiagnostics";

describe("conversation diagnostics", () => {
  it("is disabled until opted in and removes data on disable", () => {
    let now = 10;
    const d = new ConversationDiagnostics(() => now);
    expect(d.begin()).toBeNull();
    d.setEnabled(true);
    const trace = d.begin();
    now = 35;
    d.mark(trace, "submission_saved");
    expect(d.export()).toEqual([{ trace: 1, stage: "submission_saved", elapsedMs: 25 }]);
    d.setEnabled(false);
    expect(d.export()).toEqual([]);
    d.mark(trace, "reply_complete");
    d.setEnabled(true);
    d.mark(trace, "playback_start");
    expect(d.export()).toEqual([]);
  });
  it("bounds retained events and active trace ownership, and copies exports", () => {
    let now = 0;
    const d = new ConversationDiagnostics(() => now, 2);
    d.setEnabled(true);
    const a = d.begin(),
      b = d.begin(),
      c = d.begin();
    now = 10;
    d.mark(a, "reply_complete");
    d.mark(b, "submission_start");
    d.mark(c, "submission_start");
    d.mark(c, "reply_complete");
    const snapshot = d.export();
    expect(snapshot).toHaveLength(2);
    snapshot[0].elapsedMs = 999;
    expect(d.export()[0].elapsedMs).toBe(10);
    d.end(c);
    now = 20;
    d.mark(c, "playback_start");
    expect(d.export()).toHaveLength(2);
  });
  it("rejects invalid time samples without exposing data", () => {
    let now = 10;
    const d = new ConversationDiagnostics(() => now);
    d.setEnabled(true);
    const t = d.begin();
    now = 9;
    d.mark(t, "submission_start");
    now = NaN;
    d.mark(t, "reply_complete");
    expect(d.export()).toEqual([]);
  });
  it("ignores invalid stages, duplicate stages and clock failures", () => {
    let broken = false;
    const d = new ConversationDiagnostics(() => {
      if (broken) throw new Error("clock");
      return 100;
    });
    d.setEnabled(true);
    const trace = d.begin();
    d.mark(trace, "reply_complete");
    d.mark(trace, "reply_complete");
    d.mark(trace, "private words" as any);
    broken = true;
    d.mark(trace, "playback_start");
    expect(d.begin()).toBeNull();
    expect(d.export()).toEqual([{ trace: 1, stage: "reply_complete", elapsedMs: 0 }]);
  });
  it("does not record a duplicate stage after the exported event was evicted", () => {
    let now = 0;
    const d = new ConversationDiagnostics(() => now, 2);
    d.setEnabled(true);
    const trace = d.begin();
    d.mark(trace, "capture_end");
    now++;
    d.mark(trace, "transcription_start");
    now++;
    d.mark(trace, "transcription_end");
    d.mark(trace, "capture_end");
    expect(d.export().map((event) => event.stage)).toEqual([
      "transcription_start",
      "transcription_end",
    ]);
  });
});
