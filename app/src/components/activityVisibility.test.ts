import { describe, expect, it } from "vitest";
import {
  showActivityEvent,
  showHistoryMessage,
  visibleMessageContent,
  historyMessageContent,
} from "./activityVisibility";
import { extractImages } from "./images";

describe("activity visibility", () => {
  it("renders metadata-only projected tool history when enabled", () => {
    const row = {
      role: "tool",
      name: "terminal",
      context: "Workspace",
      args: { command: "Get-Date" },
    };
    expect(extractImages(historyMessageContent(row, true)).text).toContain("Get-Date");
    expect(extractImages(historyMessageContent(row, true)).text).toContain("Workspace");
    expect(historyMessageContent(row, false)).toBeNull();
    expect(historyMessageContent({ role: "user", text: "Get-Date" }, false)).toBe("Get-Date");
  });
  it("filters mixed history while preserving messages, images and compaction", () => {
    const rows = [
      { role: "user", text: "hello" },
      { role: "assistant", reasoning: "private" },
      { role: "assistant", tool_calls: [{ name: "run" }] },
      { role: "tool", text: "result" },
      { role: "assistant", text: "answer", reasoning: "private" },
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "private" },
          { type: "text", text: "commentary" },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,YWJj" },
          },
        ],
      },
      { role: "system", row_kind: "compaction", text: "summary" },
    ];
    expect(rows.filter((row) => showHistoryMessage(row, false))).toEqual([
      rows[0],
      rows[4],
      rows[5],
      rows[6],
      rows[7],
    ]);
    expect(rows.filter((row) => showHistoryMessage(row, true))).toEqual(rows);
    expect(visibleMessageContent(rows[5].content, false)).toEqual([
      { type: "text", text: "commentary" },
    ]);
  });
  it("hides activity events but keeps interim, notices, errors and requests", () => {
    const hidden = [
      "reasoning.delta",
      "thinking.delta",
      "tool.start",
      "tool.result",
      "todo.update",
      "subagent.started",
    ];
    const visible = [
      "message.interim",
      "status.update",
      "notice",
      "error",
      "approval.request",
      "clarify.request",
      "secret.request",
    ];
    expect(hidden.filter((type) => showActivityEvent({ type }, false))).toEqual([]);
    expect(visible.filter((type) => showActivityEvent({ type }, false))).toEqual(visible);
    expect(hidden.every((type) => showActivityEvent({ type }, true))).toBe(true);
  });
});
