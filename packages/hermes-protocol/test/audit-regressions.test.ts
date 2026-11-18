/// <reference lib="es2023.array" />
import { expect, it } from "vitest";
import { FakeServer, make, snapshot, until, type Frame } from "./fake-gateway.js";

import { emptyChat, snapshotChat, reduceEvent } from "../../../app/src/state/reducer.js";
it("preserves the real reducer stream across refresh, duplicate replay, completion and a new generation", async () => {
  const server = new FakeServer();
  server.currentSnapshot = { ...snapshot(), running: true };
  let chat = emptyChat();
  const events: Frame[] = [];
  const client = make(server, {
    onSnapshot: (_id, s, reason) => {
      chat = snapshotChat(s, chat, reason === "rebuild");
    },
    onEvent: (e) => {
      events.push(e);
      chat = reduceEvent(chat, e);
    },
  });
  try {
    await client.connect();
    await client.openSession("s");
    server.event("message.start", { turn_id: "turn" }, 1);
    server.event("message.delta", { turn_id: "turn", segment: 0, offset: 0, text: "Hello" }, 2);
    server.currentSnapshot = { ...snapshot("s", 1, 2), running: true };
    server.replay = [
      {
        session_id: "s",
        type: "message.start",
        seq: 1,
        execution_generation: 2,
        replay_epoch: "epoch",
        payload: { turn_id: "turn" },
      },
      {
        session_id: "s",
        type: "message.delta",
        seq: 2,
        execution_generation: 2,
        replay_epoch: "epoch",
        payload: { turn_id: "turn", segment: 0, offset: 0, text: "Hello" },
      },
    ];
    await client.refreshSession("s");
    await client.refreshSession("s");
    expect(chat.liveText).toBe("Hello");
    expect(
      server.calls.filter((f) => f.method === "session.events.since").slice(-1)[0].params
        .last_sequence,
    ).toBe(2);
    server.event("message.delta", { turn_id: "turn", segment: 0, offset: 5, text: " world" }, 3);
    expect(chat.liveText).toBe("Hello world");
    server.event("message.complete", { turn_id: "turn", text: "Hello world" }, 4);
    server.event(
      "message.delta",
      { turn_id: "turn", segment: 0, offset: 0, text: "Hello world" },
      5,
    );
    expect(events.filter((e) => e.type === "message.delta")).toHaveLength(2);
    expect((client as any).sessions.get("s").segments.size).toBe(0);
    server.event("message.start", { turn_id: "next" }, 6, "s", 3);
    server.event(
      "message.delta",
      { turn_id: "next", segment: 0, offset: 0, text: "Next" },
      7,
      "s",
      3,
    );
    expect(chat.liveText).toBe("Next");
  } finally {
    client.close();
  }
});

it.each(["error", "timeout", "malformed"])(
  "retires a subscription after post-resume replay %s",
  async (mode) => {
    const server = new FakeServer();
    server.currentSnapshot = { ...snapshot(), running: true };
    const events: Frame[] = [];
    server.custom = (socket, frame) => {
      if (frame.method !== "session.events.since") return false;
      if (mode === "error")
        queueMicrotask(() =>
          socket.frame({
            jsonrpc: "2.0",
            id: frame.id,
            error: { code: -32603, message: "fixture replay failure" },
          }),
        );
      if (mode === "malformed")
        queueMicrotask(() =>
          socket.frame({ jsonrpc: "2.0", id: frame.id, result: { events: [] } }),
        );
      return true;
    };
    const client = make(server, { onEvent: (e) => events.push(e), backoff: () => 10000 });
    try {
      await client.connect();
      await expect(client.openSession("s")).rejects.toThrow();
      expect(server.socket.readyState).toBe(3);
      expect(client.getSession("s")).toBeUndefined();
      server.event("message.delta", { turn_id: "turn", segment: 0, offset: 0, text: "same" }, 1);
      expect(events.filter((e) => e.type === "message.delta")).toHaveLength(0);
    } finally {
      client.close();
    }
  },
);

it("releases completed segment text over many turns", async () => {
  const server = new FakeServer();
  const client = make(server);
  try {
    await client.connect();
    await client.openSession("s");
    for (let i = 0; i < 520; i++) {
      server.event("message.start", { turn_id: `turn-${i}` }, i * 3 + 1);
      server.event(
        "message.delta",
        { turn_id: `turn-${i}`, segment: 0, offset: 0, text: "x".repeat(1000) },
        i * 3 + 2,
      );
      server.event("message.complete", { turn_id: `turn-${i}`, text: "x".repeat(1000) }, i * 3 + 3);
    }
    expect((client as any).sessions.get("s").segments.size).toBe(0);
    expect((client as any).sessions.get("s").completedTurns.size).toBe(512);
  } finally {
    client.close();
  }
});

it("reconnects after completion without replaying retired text, then accepts a new turn", async () => {
  const server = new FakeServer();
  const events: Frame[] = [];
  const client = make(server, { onEvent: (e) => events.push(e) });
  try {
    await client.connect();
    await client.openSession("s");
    server.event("message.start", { turn_id: "first" }, 1);
    server.event("message.delta", { turn_id: "first", segment: 0, offset: 0, text: "done" }, 2);
    server.event("message.complete", { turn_id: "first", text: "done" }, 3);
    server.currentSnapshot = snapshot("s", 1, 3);
    server.replay = [
      {
        session_id: "s",
        type: "message.delta",
        seq: 2,
        execution_generation: 2,
        replay_epoch: "epoch",
        payload: { turn_id: "first", segment: 0, offset: 0, text: "done" },
      },
    ];
    server.socket.close();
    await until(() => client.connectionState === "ready" && server.sockets.length === 2);
    server.event("message.delta", { turn_id: "first", segment: 0, offset: 0, text: "done" }, 4);
    server.event("message.start", { turn_id: "next" }, 5);
    server.event("message.delta", { turn_id: "next", segment: 0, offset: 0, text: "new" }, 6);
    expect(events.filter((e) => e.type === "message.delta").map((e) => e.payload.text)).toEqual([
      "done",
      "new",
    ]);
  } finally {
    client.close();
  }
});

it("sends caller identity only when supported and retains the SDK default", async () => {
  const server = new FakeServer();
  const client = make(server, { clientIdentity: { name: "test-app", version: "9.8.7" } });
  try {
    await client.connect();
    await client.createSession();
    expect(server.calls.find((f) => f.method === "session.create")?.params.client).toEqual({
      name: "test-app",
      version: "9.8.7",
    });
  } finally {
    client.close();
  }
  const other = new FakeServer();
  const defaultClient = make(other);
  try {
    await defaultClient.connect();
    await defaultClient.createSession();
    expect(other.calls.find((f) => f.method === "session.create")?.params.client).toEqual({
      name: "hermes-mobile",
      version: "0.1.0",
    });
  } finally {
    defaultClient.close();
  }
});

it("reconnects from the delivered cursor when refresh replay fails", async () => {
  const server = new FakeServer();
  const events: Frame[] = [];
  const client = make(server, { onEvent: (e) => events.push(e) });
  try {
    await client.connect();
    await client.openSession("s");
    server.event("message.start", { turn_id: "turn" }, 1);
    server.currentSnapshot = { ...snapshot("s", 1, 2), running: true };
    let failed = false;
    server.custom = (socket, frame) => {
      if (frame.method === "session.events.since" && !failed) {
        failed = true;
        queueMicrotask(() =>
          socket.frame({
            jsonrpc: "2.0",
            id: frame.id,
            error: { code: -32603, message: "replay failed" },
          }),
        );
        return true;
      }
      return false;
    };
    server.replay = [
      {
        session_id: "s",
        type: "message.delta",
        seq: 2,
        execution_generation: 2,
        replay_epoch: "epoch",
        payload: { turn_id: "turn", segment: 0, offset: 0, text: "recovered" },
      },
    ];
    await expect(client.refreshSession("s")).rejects.toThrow("replay failed");
    await until(() => client.connectionState === "ready" && server.sockets.length === 2);
    expect(
      server.calls.filter((f) => f.method === "session.events.since").at(-1)?.params.last_sequence,
    ).toBe(1);
    expect(events.filter((e) => e.type === "message.delta").map((e) => e.payload.text)).toEqual([
      "recovered",
    ]);
  } finally {
    client.close();
  }
});

it("reports an unavailable prefix after a refresh replay gap", async () => {
  const server = new FakeServer();
  const partial: Frame[] = [];
  const events: Frame[] = [];
  server.currentSnapshot = { ...snapshot(), running: true };
  const client = make(server, {
    onPartialUnavailable: (_id, info) => partial.push(info),
    onEvent: (e) => events.push(e),
  });
  try {
    await client.connect();
    await client.openSession("s");
    server.snapshotRequired = true;
    await client.refreshSession("s");
    server.event("message.delta", { turn_id: "turn", segment: 0, offset: 5, text: "suffix" }, 1);
    expect(events.some((e) => e.type === "session.replay_gap")).toBe(true);
    expect(partial).toEqual([{ turn: "turn", segment: 0, offset: 5 }]);
    expect(events.filter((e) => e.type === "message.delta").map((e) => e.payload.text)).toEqual([
      "suffix",
    ]);
  } finally {
    client.close();
  }
});

it("fences socket frames immediately while transport close is pending", async () => {
  const server = new FakeServer();
  server.currentSnapshot = { ...snapshot(), running: true };
  const events: Frame[] = [];
  server.custom = (socket, frame) => {
    if (frame.method !== "session.events.since") return false;
    queueMicrotask(() =>
      socket.frame({
        jsonrpc: "2.0",
        id: frame.id,
        error: { code: -32603, message: "replay failed" },
      }),
    );
    return true;
  };
  const client = make(server, { onEvent: (e) => events.push(e), backoff: () => 10000 });
  try {
    await client.connect();
    const socket = server.socket;
    socket.close = () => {}; // Simulate a transport that has not emitted close yet.
    await expect(client.openSession("s")).rejects.toThrow();
    socket.event({
      type: "message.delta",
      session_id: "s",
      seq: 1,
      replay_epoch: "epoch",
      execution_generation: 2,
      payload: { turn_id: "turn", segment: 0, offset: 0, text: "late" },
    });
    expect(events.filter((e) => e.type === "message.delta")).toHaveLength(0);
  } finally {
    client.close();
  }
});

it("refreshes from the delivered cursor into a new running generation", async () => {
  const server = new FakeServer();
  server.currentSnapshot = { ...snapshot(), running: true };
  let chat = emptyChat();
  const client = make(server, {
    onSnapshot: (_id, s, reason) => {
      chat = snapshotChat(s, chat, reason === "rebuild");
    },
    onEvent: (e) => {
      chat = reduceEvent(chat, e);
    },
  });
  try {
    await client.connect();
    await client.openSession("s");
    server.event("message.start", { turn_id: "old" }, 1);
    server.event("message.delta", { turn_id: "old", segment: 0, offset: 0, text: "old" }, 2);
    server.currentSnapshot = { ...snapshot("s", 1, 4), running: true, execution_generation: 3 };
    server.replay = [
      {
        session_id: "s",
        type: "message.start",
        seq: 3,
        execution_generation: 3,
        replay_epoch: "epoch",
        payload: { turn_id: "new" },
      },
      {
        session_id: "s",
        type: "message.delta",
        seq: 4,
        execution_generation: 3,
        replay_epoch: "epoch",
        payload: { turn_id: "new", segment: 0, offset: 0, text: "new" },
      },
    ];
    await client.refreshSession("s");
    expect(
      server.calls.filter((f) => f.method === "session.events.since").at(-1)?.params.last_sequence,
    ).toBe(2);
    expect(chat.liveText).toBe("new");
    server.event(
      "message.delta",
      { turn_id: "new", segment: 0, offset: 3, text: " text" },
      5,
      "s",
      3,
    );
    expect(chat.liveText).toBe("new text");
  } finally {
    client.close();
  }
});

it("retires an alias-resolved acquisition when initial replay fails", async () => {
  const server = new FakeServer();
  const events: Frame[] = [];
  server.custom = (socket, frame) => {
    if (frame.method === "session.resume") {
      queueMicrotask(() =>
        socket.frame({
          jsonrpc: "2.0",
          id: frame.id,
          result: { ...snapshot("owner"), running: true },
        }),
      );
      return true;
    }
    if (frame.method === "session.events.since") {
      queueMicrotask(() =>
        socket.frame({
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32603, message: "replay failed" },
        }),
      );
      return true;
    }
    return false;
  };
  const client = make(server, { onEvent: (e) => events.push(e), backoff: () => 10000 });
  try {
    await client.connect();
    await expect(client.openSession("alias")).rejects.toThrow("replay failed");
    expect(server.calls.find((f) => f.method === "session.events.since")?.params.session_id).toBe(
      "owner",
    );
    expect(server.socket.readyState).toBe(3);
    expect(client.getSession("alias")).toBeUndefined();
    expect(client.getSession("owner")).toBeUndefined();
    server.event(
      "message.delta",
      { turn_id: "x", segment: 0, offset: 0, text: "late" },
      1,
      "owner",
    );
    expect(events.filter((e) => e.type === "message.delta")).toHaveLength(0);
  } finally {
    client.close();
  }
});

it("does not replay retired text when refreshing a completed snapshot", async () => {
  const server = new FakeServer();
  const events: Frame[] = [];
  const client = make(server, { onEvent: (e) => events.push(e) });
  try {
    await client.connect();
    await client.openSession("s");
    server.event("message.start", { turn_id: "done" }, 1);
    server.event("message.delta", { turn_id: "done", segment: 0, offset: 0, text: "complete" }, 2);
    server.event("message.complete", { turn_id: "done", text: "complete" }, 3);
    server.currentSnapshot = snapshot("s", 1, 3);
    server.replay = [
      {
        session_id: "s",
        type: "message.delta",
        seq: 2,
        execution_generation: 2,
        replay_epoch: "epoch",
        payload: { turn_id: "done", segment: 0, offset: 0, text: "complete" },
      },
    ];
    const replayCalls = server.calls.filter((f) => f.method === "session.events.since").length;
    await client.refreshSession("s");
    expect(server.calls.filter((f) => f.method === "session.events.since")).toHaveLength(
      replayCalls,
    );
    expect(events.filter((e) => e.type === "message.delta").map((e) => e.payload.text)).toEqual([
      "complete",
    ]);
    expect((client as any).sessions.get("s").segments.size).toBe(0);
  } finally {
    client.close();
  }
});

it("retires only the exact completed turn when turn IDs contain colons", async () => {
  const server = new FakeServer();
  const client = make(server);
  try {
    await client.connect();
    await client.openSession("s");
    server.event("message.delta", { turn_id: "a:b", segment: 0, offset: 0, text: "keep" }, 1);
    server.event("message.delta", { turn_id: "a", segment: 0, offset: 0, text: "retire" }, 2);
    server.event("message.complete", { turn_id: "a", text: "retire" }, 3);
    const segments = (client as any).sessions.get("s").segments as Map<string, unknown>;
    expect([...segments.keys()]).toEqual(["a:b:0"]);
  } finally {
    client.close();
  }
});
