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
  it("records each new stage once per trace", () => {
    let now = 0;
    const d = new ConversationDiagnostics(() => now);
    d.setEnabled(true);
    const a = d.begin(),
      b = d.begin();
    for (const stage of ["submit_sent", "first_delta", "tts_request_start", "tts_ready"] as const) {
      now += 5;
      d.mark(a, stage);
      d.mark(a, stage);
      d.mark(b, stage);
    }
    const events = d.export();
    expect(events.filter((e) => e.trace === a).map((e) => [e.stage, e.elapsedMs])).toEqual([
      ["submit_sent", 5],
      ["first_delta", 10],
      ["tts_request_start", 15],
      ["tts_ready", 20],
    ]);
    expect(events.filter((e) => e.trace === b)).toHaveLength(4);
  });
  it("keeps samples, events and render counts within capacity", () => {
    let now = 0;
    const d = new ConversationDiagnostics(() => now, 3);
    d.setEnabled(true);
    for (let n = 0; n < 10; n++) {
      const timer = d.startTimer();
      now += n;
      d.sample("persist_ms", timer, 100 + n);
      d.countRender("chat_screen");
      d.mark(d.begin(), "first_delta");
    }
    const report = d.report();
    expect(report.samples).toEqual([
      { name: "persist_ms", ms: 7, chars: 107 },
      { name: "persist_ms", ms: 8, chars: 108 },
      { name: "persist_ms", ms: 9, chars: 109 },
    ]);
    expect(report.events).toHaveLength(3);
    expect(report.renders).toEqual({
      chat_screen: 10,
      timeline_item: 0,
      live_message: 0,
      message_input: 0,
    });
    report.samples[0].ms = 999;
    expect(d.report().samples[0].ms).toBe(7);
  });
  it("records nothing while disabled and clears everything when disabled", () => {
    let now = 0;
    const d = new ConversationDiagnostics(() => now);
    const empty = {
      events: [],
      samples: [],
      renders: { chat_screen: 0, timeline_item: 0, live_message: 0, message_input: 0 },
    };
    expect(d.startTimer()).toBeNull();
    d.sample("session_open_ms", { at: 0, generation: 0 });
    d.countRender("message_input");
    d.mark(d.begin(), "first_delta");
    expect(d.report()).toEqual(empty);
    d.setEnabled(true);
    const timer = d.startTimer();
    const trace = d.begin();
    now = 4;
    d.sample("connect_ready_ms", timer);
    d.mark(trace, "submit_sent");
    d.countRender("live_message");
    expect(d.report().samples).toEqual([{ name: "connect_ready_ms", ms: 4 }]);
    expect(d.report().renders.live_message).toBe(1);
    d.setEnabled(false);
    expect(d.report()).toEqual(empty);
    // A timer or trace started before the switch went off records nothing after re-enabling.
    d.setEnabled(true);
    d.sample("cache_restore_ms", timer);
    d.mark(trace, "first_delta");
    expect(d.report()).toEqual(empty);
  });
  it("rejects unknown sample and counter names, bad sizes and clock failures", () => {
    let now = 0,
      broken = false;
    const d = new ConversationDiagnostics(() => {
      if (broken) throw new Error("clock");
      return now;
    });
    d.setEnabled(true);
    const timer = d.startTimer();
    d.sample("private words" as any, timer);
    d.countRender("private words" as any);
    d.sample("persist_ms", timer, -1);
    d.sample("persist_ms", timer, 1.5);
    now = -1;
    d.sample("persist_ms", timer, 3);
    now = NaN;
    d.sample("persist_ms", timer, 3);
    broken = true;
    expect(d.startTimer()).toBeNull();
    d.sample("persist_ms", timer, 3);
    const report = d.report();
    expect(report.samples).toEqual([
      { name: "persist_ms", ms: 0 },
      { name: "persist_ms", ms: 0 },
    ]);
    expect(Object.keys(report.renders)).not.toContain("private words");
    expect(JSON.stringify(report)).not.toContain("private");
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
