import { describe, expect, it } from "vitest";
import { chatAttentionKey, chatDraftKey, filterSessions, sessionFlags } from "./sessionFilters";

describe("session filters", () => {
  it("includes image-only drafts and updates a stable draft subscription when removed", () => {
    const rows = [
      { id: "photo", title: "Photo" },
      { id: "caption", title: "Caption" },
    ];
    const key = chatDraftKey({
      photo: { draftAttachments: [{}] },
      caption: { draftAttachments: [{}, {}] },
    });
    const inventory = sessionFlags(rows, { caption: "My note" }, "[]", [], [], true, key);
    expect(inventory.counts.drafts).toBe(2);
    expect(inventory.flags.photo.draft).toBe("1 image");
    expect(inventory.flags.caption.draft).toBe("My note");
    expect(filterSessions(rows, inventory.flags, "drafts", "")).toEqual(rows);
    const removed = chatDraftKey({
      photo: { draftAttachments: [] },
      caption: { draftAttachments: [{}, {}] },
    });
    expect(removed).not.toBe(key);
    expect(
      sessionFlags(rows, { caption: "My note" }, "[]", [], [], true, removed).counts.drafts,
    ).toBe(1);
    expect(chatDraftKey({ photo: { pending: [{ status: "queued" }] } })).toBe("[]");
  });
  const rows = [
    { id: "a", title: "Project A", running: true, unread: true },
    { id: "b", title: "Project B" },
    { id: "c", title: "Ideas" },
    { id: "d", title: "Errors" },
  ];
  it("counts loaded sessions, meaningful drafts and genuine attention without treating waiting work as failed", () => {
    const chats = {
      a: { pending: [{ status: "queued" }, { status: "started" }] },
      b: { pending: [{ status: "unknown" }] },
      c: { prompts: [{ kind: "clarify" }] },
    };
    const drafts = { a: "  unfinished\nthought  ", b: "  \n  " };
    const outbox = [{ session_id: "d", error: "rejected" }, { session_id: "a" }];
    const result = sessionFlags(rows, drafts, chatAttentionKey(chats), outbox, [], true);
    expect(result.counts).toEqual({ all: 4, running: 1, attention: 3, unread: 1, drafts: 1 });
    expect(result.flags.a).toMatchObject({ attention: false, draft: "unfinished\nthought" });
    expect(filterSessions(rows, result.flags, "attention", "")).toEqual([
      rows[1],
      rows[2],
      rows[3],
    ]);
    expect(filterSessions(rows, result.flags, "drafts", "thought")).toEqual([rows[0]]);
    expect(filterSessions(rows, result.flags, "drafts", "project b")).toEqual([]);
  });
  it("includes failed queued edits and failed local messages, but not ordinary queue entries", () => {
    const key = chatAttentionKey({
      a: { localMessages: [{ status: "failed" }] },
      b: { pending: [{ status: "queued" }] },
    });
    const { flags } = sessionFlags(
      rows,
      {},
      key,
      [],
      [{ session_id: "c", error: "failed" }, { session_id: "b" }],
      true,
    );
    expect(flags.a.attention).toBe(true);
    expect(flags.b.attention).toBe(false);
    expect(flags.c.attention).toBe(true);
  });
  it("does not claim cached sessions are running while disconnected", () => {
    const { counts, flags } = sessionFlags(rows, {}, "[]", [], [], false);
    expect(counts.running).toBe(0);
    expect(filterSessions(rows, flags, "running", "")).toEqual([]);
    expect(filterSessions(rows, flags, "unread", "")).toEqual([rows[0]]);
  });
  it("does not change the attention snapshot for non-actionable streaming changes", () => {
    expect(chatAttentionKey({ a: { pending: [{ status: "started" }] } })).toBe(
      chatAttentionKey({ a: { pending: [{ status: "queued" }] } }),
    );
    expect(
      chatAttentionKey({ b: { prompts: [{}] }, a: { pending: [{ status: "unknown" }] } }),
    ).toBe('["a","b"]');
  });
  it("treats opaque session IDs as data, including keys inherited by ordinary objects", () => {
    const unusual = [
      { id: "__proto__", title: "A" },
      { id: "constructor", title: "B" },
    ];
    const { flags, counts } = sessionFlags(unusual, {}, "[]", [], [], true);
    expect(counts.drafts).toBe(0);
    expect(filterSessions(unusual, flags, "all", "")).toEqual(unusual);
  });
});
