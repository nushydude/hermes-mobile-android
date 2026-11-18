import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  origin: "https://one.test",
  epoch: 1,
  session: "s",
  rows: new Map<string, string>(),
  listener: undefined as undefined | ((e: any) => void),
  request: vi.fn(),
  readGate: null as null | Promise<void>,
  failOpen: false,
  failSchema: false,
  close: vi.fn(),
}));
vi.mock("expo-sqlite", () => ({
  openDatabaseSync: () => {
    if (m.failOpen) throw Error("open");
    return {
      execSync() {
        if (m.failSchema) throw Error("schema");
      },
      closeSync: m.close,
      getFirstAsync: async (_sql: string, key: string) => {
        if (m.readGate) await m.readGate;
        return m.rows.has(key) ? { value: m.rows.get(key) } : null;
      },
      runAsync: async (_sql: string, key: string, value: string) => m.rows.set(key, value),
    };
  },
}));
vi.mock("./index", () => ({
  appManager: {
    subscribeVoiceEvents: (fn: any) => {
      m.listener = fn;
      return () => {};
    },
    getConfiguredOrigin: () => m.origin,
    getEndpointEpoch: () => m.epoch,
    getState: () => ({ activeSessionId: m.session }),
    request: m.request,
  },
}));
import { taskStore } from "./taskStore";
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
beforeEach(() => {
  m.rows.clear();
  m.readGate = null;
  m.origin = "";
  taskStore.activate("");
  m.epoch++;
  m.origin = `https://${m.epoch}.test`;
  m.session = "s";
  m.request.mockReset();
});
describe("task store scope and persistence", () => {
  it("restores live records as unknown and keeps observed terminal records", async () => {
    m.rows.set(
      m.origin,
      JSON.stringify({
        origin: m.origin,
        sessions: [
          [
            "s",
            [
              { id: "a", goal: "A", status: "running" },
              { id: "b", goal: "B", status: "complete" },
            ],
          ],
        ],
      }),
    );
    taskStore.activate(m.origin);
    await vi.waitFor(() =>
      expect(taskStore.get(m.origin, "s").map((x) => x.status)).toEqual(["unknown", "complete"]),
    );
  });
  it("does not let a stale roster overwrite a newer event", async () => {
    const gate = deferred();
    m.request.mockReturnValueOnce(gate.promise);
    const load = taskStore.refresh(m.origin, "s", m.epoch);
    m.listener?.({
      type: "subagent.complete",
      session_id: "s",
      payload: { subagent_id: "a", status: "completed" },
    });
    gate.resolve({ subagents: [{ subagent_id: "a", status: "running" }] });
    await load;
    expect(taskStore.get(m.origin, "s")[0].status).toBe("complete");
  });
  it("applies a pending roster when a different session receives an event", async () => {
    const gate = deferred();
    m.request.mockReturnValueOnce(gate.promise);
    const load = taskStore.refresh(m.origin, "s", m.epoch);
    m.listener?.({ type: "subagent.start", session_id: "other", payload: { subagent_id: "b" } });
    gate.resolve({ subagents: [{ subagent_id: "a", status: "running" }] });
    await load;
    expect(taskStore.get(m.origin, "s").map((x) => x.id)).toEqual(["a"]);
    expect(taskStore.get(m.origin, "other").map((x) => x.id)).toEqual(["b"]);
  });
  it("merges a delayed restore with newer observed events", async () => {
    const gate = deferred();
    m.readGate = gate.promise;
    m.rows.set(
      m.origin,
      JSON.stringify({
        origin: m.origin,
        sessions: [["s", [{ id: "old", goal: "Old", status: "complete" }]]],
      }),
    );
    taskStore.activate(m.origin);
    m.listener?.({
      type: "subagent.start",
      session_id: "s",
      payload: { subagent_id: "new", goal: "New" },
    });
    gate.resolve(undefined);
    await vi.waitFor(() =>
      expect(taskStore.get(m.origin, "s").map((x) => [x.id, x.status])).toEqual([
        ["old", "complete"],
        ["new", "running"],
      ]),
    );
  });
  it("keeps cached terminal status when a live update races restore", async () => {
    const gate = deferred();
    m.readGate = gate.promise;
    m.rows.set(
      m.origin,
      JSON.stringify({
        origin: m.origin,
        sessions: [["s", [{ id: "a", goal: "Old", status: "complete" }]]],
      }),
    );
    taskStore.activate(m.origin);
    m.listener?.({ type: "subagent.start", session_id: "s", payload: { subagent_id: "a" } });
    gate.resolve(undefined);
    await vi.waitFor(() => expect(taskStore.get(m.origin, "s")[0].status).toBe("complete"));
  });
  it.each(["before", "after"])(
    "keeps the cached first terminal when a contradictory terminal arrives %s restore",
    async (order) => {
      const gate = deferred();
      if (order === "before") m.readGate = gate.promise;
      m.rows.set(
        m.origin,
        JSON.stringify({
          origin: m.origin,
          sessions: [["s", [{ id: "a", goal: "Old", status: "complete" }]]],
        }),
      );
      taskStore.activate(m.origin);
      if (order === "after")
        await vi.waitFor(() => expect(taskStore.get(m.origin, "s")[0]?.status).toBe("complete"));
      m.listener?.({
        type: "subagent.complete",
        session_id: "s",
        payload: { subagent_id: "a", status: "failed" },
      });
      if (order === "before") gate.resolve(undefined);
      await vi.waitFor(() => expect(taskStore.get(m.origin, "s")[0]?.status).toBe("complete"));
    },
  );
  it("discards old-origin responses and fences stop after session change", async () => {
    const old = m.origin,
      epoch = m.epoch,
      gate = deferred();
    m.request.mockReturnValueOnce(gate.promise);
    const load = taskStore.refresh(old, "s", epoch);
    m.origin = "https://two.test";
    m.epoch++;
    gate.resolve({ subagents: [{ subagent_id: "x", status: "running" }] });
    await load;
    taskStore.activate(m.origin);
    expect(taskStore.get(m.origin, "s")).toEqual([]);
    await expect(taskStore.interrupt(old, "s", "x", epoch)).rejects.toThrow("Conversation changed");
    expect(m.request).toHaveBeenCalledTimes(1);
  });
});
describe("optional cache initialization", () => {
  it.each(["open", "schema", "schema and close"])(
    "continues in memory when %s fails during module import",
    async (mode) => {
      vi.resetModules();
      m.close.mockReset();
      m.failOpen = mode === "open";
      m.failSchema = mode !== "open";
      if (mode === "schema and close")
        m.close.mockImplementation(() => {
          throw Error("close");
        });
      try {
        const { taskStore: store } = await import("./taskStore");
        store.activate(m.origin);
        m.listener?.({
          type: "subagent.start",
          session_id: "s",
          payload: { subagent_id: "memory", goal: "Working" },
        });
        expect(store.get(m.origin, "s")).toMatchObject([{ id: "memory", status: "running" }]);
        expect(m.close).toHaveBeenCalledTimes(mode === "open" ? 0 : 1);
      } finally {
        m.failOpen = false;
        m.failSchema = false;
      }
    },
  );
});
