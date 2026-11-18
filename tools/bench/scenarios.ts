// Host benchmark scenarios for the real AppManager. Counts and sizes only, never wall-clock time.
// Run through `npm run bench` (tools/bench/run.mjs), which prints the table. See README.md.
import { writeFileSync } from "node:fs";
import { afterAll, afterEach, it, vi } from "vitest";

type LogEntry =
  | { kind: "write"; key: string; chars: number }
  | { kind: "rpc"; method: string }
  | { kind: "open"; resumed: boolean }
  | { kind: "ack" };

const h = vi.hoisted(() => ({
  log: [] as LogEntry[],
  rows: new Map<string, string>(),
  secure: new Map<string, string>(),
  uuid: 0,
  gateway: null as null | {
    snapshot: (id: string) => any;
    inventory: () => any[];
    transcript: (id: string) => any[];
  },
}));

vi.mock("react-native", () => ({ AppState: { addEventListener: () => undefined } }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => undefined },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => h.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    h.secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    h.secure.delete(key);
  },
}));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    getFirstAsync: async (_sql: string, key: string) => {
      const value = h.rows.get(key);
      return value ? { value } : null;
    },
    runAsync: async (_sql: string, key: string, value: string) => {
      h.log.push({ kind: "write", key, chars: value.length });
      h.rows.set(key, value);
    },
  }),
}));
vi.mock("../../app/src/notifications", () => ({
  notifyEvent: async () => {},
  reconcileSnapshot: async () => {},
}));
vi.mock("@hermes-mobile/protocol", () => {
  class JsonRpcGatewayError extends Error {}
  // Mirrors the ordering of the real CanonicalClient (packages/hermes-protocol/src/client.ts):
  // openSession returns the held snapshot for an attached session and only sends session.resume
  // otherwise; submit persists, then sends prompt.submit, then acknowledges.
  class CanonicalClient {
    opts: any;
    connectionState = "offline";
    attached = new Map<string, any>();
    constructor(opts: any) {
      this.opts = opts;
    }
    async connect() {
      this.connectionState = "ready";
      this.opts.onState?.("ready");
    }
    async openSession(id: string) {
      const held = this.attached.get(id);
      if (held) {
        h.log.push({ kind: "open", resumed: false });
        return held;
      }
      h.log.push({ kind: "open", resumed: true });
      h.log.push({ kind: "rpc", method: "session.resume" });
      const snapshot = h.gateway!.snapshot(id);
      this.attached.set(id, snapshot);
      this.opts.onSnapshot?.(id, snapshot, "resume");
      return snapshot;
    }
    async request(method: string, params: any) {
      h.log.push({ kind: "rpc", method });
      if (method === "session.list")
        return { sessions: params.scope === "stored" ? h.gateway!.inventory() : [] };
      if (method === "session.transcript")
        return { rows: h.gateway!.transcript(params.session_id), next_cursor: null };
      return {};
    }
    async submit(item: any) {
      if (!this.attached.has(item.session_id)) throw new Error("Resume the session first");
      await this.opts.persistSubmission(item);
      h.log.push({ kind: "rpc", method: "prompt.submit" });
      const receipt = { admission_id: `adm-${item.submission_id}` };
      await this.opts.acknowledgeSubmission(item, receipt);
      h.log.push({ kind: "ack" });
      return receipt;
    }
    async detachSession(id: string) {
      this.attached.delete(id);
    }
    getSession() {
      return { execution_generation: 1 };
    }
    close() {}
    async reconnectNow() {}
  }
  return {
    CanonicalClient,
    JsonRpcGatewayError,
    // Same length as a real UUID, so serialized sizes match production.
    randomUUID: () => `00000000-0000-4000-8000-${String(++h.uuid).padStart(12, "0")}`,
  };
});

import { AppManager } from "../../app/src/state/index";
import { snapshotChat } from "../../app/src/state/reducer";

// ---- Fixture -------------------------------------------------------------------------------
const ORIGIN = "https://bench.invalid";
const CACHED_CHATS = 8;
const ROWS_PER_CHAT = 50;
const ROW_CHARS = 1024;
const INVENTORY_SESSIONS = 40;
const REPLY_CHARS = 4000;
const REPLY_DELTAS = 100;
const DELTA_INTERVALS_MS = [100, 20];
const TYPED_CHARS = 80;
const KEY_INTERVAL_MS = 150;

const sid = (n: number) => `bench-session-${String(n).padStart(2, "0")}`;
const EPOCH = "bench-epoch";
const LAST_SEQUENCE = 1000;

function rowText(n: number) {
  const head = `Message ${n}. **Benchmark row** with a [link](https://example.invalid/${n}).\n\n`;
  const code = "```ts\nconst answer = " + n + ";\n```\n\n";
  return (head + code + "Plain words in a paragraph. ".repeat(40)).slice(0, ROW_CHARS);
}
function rows(session: number, count = ROWS_PER_CHAT, from = 1) {
  return Array.from({ length: count }, (_, i) => {
    const n = from + i;
    return {
      row_id: session * 1000 + n,
      role: n % 2 ? "user" : "assistant",
      text: rowText(n),
    };
  });
}
function snapshot(session: number) {
  return {
    session_id: sid(session),
    subscription_id: `sub-${session}`,
    replay_epoch: EPOCH,
    last_sequence: LAST_SEQUENCE,
    revision: 1,
    execution_generation: 1,
    running: false,
    display_messages: rows(session),
    pending: [],
    prompts: [],
    info: {},
  };
}
function inventory() {
  return Array.from({ length: INVENTORY_SESSIONS }, (_, n) => ({
    id: sid(n),
    session_id: sid(n),
    title: `Benchmark session ${n}`,
    preview: "A short preview line for the session list.",
    model: "bench-model",
    cwd: "C:/bench/workspace",
    last_active_at: 1_800_000_000 - n * 60,
  }));
}
const replyText = Array.from({ length: REPLY_DELTAS }, (_, i) =>
  `Delta ${String(i).padStart(3, "0")} **bold** words, more text.`.padEnd(
    REPLY_CHARS / REPLY_DELTAS,
    ".",
  ),
);

async function settle() {
  for (let guard = 0; guard < 1000; guard++) {
    for (let n = 0; n < 20; n++) await Promise.resolve();
    if (vi.getTimerCount() === 0) {
      for (let n = 0; n < 20; n++) await Promise.resolve();
      if (vi.getTimerCount() === 0) return;
    }
    await vi.runOnlyPendingTimersAsync();
  }
  throw new Error("Manager did not settle");
}

/** A fresh manager restored from a cache of eight 50-row chats, connected and settled. */
async function setup() {
  h.log = [];
  h.uuid = 0;
  h.rows = new Map();
  h.secure = new Map([
    ["hermes.config.v1", JSON.stringify({ version: 1, origin: ORIGIN, token: "t" })],
  ]);
  const extraRows = new Map<string, any[]>();
  h.gateway = {
    snapshot: (id) => snapshot(Number(id.slice(-2))),
    inventory,
    transcript: (id) => {
      const n = Number(id.slice(-2));
      return [...rows(n), ...(extraRows.get(id) ?? [])].slice(-ROWS_PER_CHAT);
    },
  };
  const chats: Record<string, unknown> = {};
  for (let n = 0; n < CACHED_CHATS; n++) chats[sid(n)] = snapshotChat(snapshot(n) as any);
  const payload = {
    sessions: inventory(),
    chats,
    drafts: {},
    draftRevision: 1,
    outbox: [],
    historyTruncated: false,
    nextOrdinal: 1,
    queuedEdits: [],
    recent: Array.from({ length: CACHED_CHATS }, (_, n) => sid(n)),
  };
  h.rows.set(`state:${ORIGIN}`, JSON.stringify({ version: 1, origin: ORIGIN, payload }));
  const manager = new AppManager();
  await manager.initialize();
  await settle();
  return { manager, extraRows };
}
function since(start: number) {
  return h.log.slice(start);
}
function writes(entries: LogEntry[]) {
  const list = entries.filter((e): e is Extract<LogEntry, { kind: "write" }> => e.kind === "write");
  return { writes: list.length, chars: list.reduce((sum, e) => sum + e.chars, 0) };
}

// ---- Scenarios -----------------------------------------------------------------------------
const results: Record<string, any> = {};
let active: AppManager | null = null;
afterEach(() => {
  active?.dispose();
  active = null;
  vi.useRealTimers();
});
afterAll(() => {
  const out = process.env.HERMES_BENCH_OUT;
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
});

it("fixture", async () => {
  vi.useFakeTimers();
  const { manager } = await setup();
  active = manager;
  const start = h.log.length;
  await manager.openSession(sid(0));
  await settle();
  const full = since(start).find((e) => e.kind === "write") as any;
  results.fixture = {
    cachedChats: CACHED_CHATS,
    rowsPerChat: ROWS_PER_CHAT,
    rowChars: ROW_CHARS,
    inventorySessions: INVENTORY_SESSIONS,
    fullWriteChars: full.chars,
  };
});

for (const interval of DELTA_INTERVALS_MS)
  it(`streamed reply every ${interval} ms`, async () => {
    vi.useFakeTimers();
    const { manager, extraRows } = await setup();
    active = manager;
    const id = sid(0);
    await manager.openSession(id);
    await settle();
    let previous = manager.getState().chats[id]?.liveText ?? "";
    let emissions = 0,
      liveEmissions = 0,
      liveChars = 0;
    const unsubscribe = manager.subscribe(() => {
      emissions++;
      const live = manager.getState().chats[id]?.liveText ?? "";
      if (live !== previous) {
        liveEmissions++;
        liveChars += live.length;
        previous = live;
      }
    });
    const client = (manager as any).client;
    const start = h.log.length;
    let seq = LAST_SEQUENCE;
    const event = (type: string, payload: Record<string, unknown>) =>
      client.opts.onEvent({ type, session_id: id, replay_epoch: EPOCH, seq: ++seq, payload });
    event("message.start", {});
    for (const text of replyText) {
      await vi.advanceTimersByTimeAsync(interval);
      event("message.delta", { text });
    }
    await vi.advanceTimersByTimeAsync(interval);
    const full = replyText.join("");
    extraRows.set(id, [{ row_id: 51, role: "assistant", text: full }]);
    event("message.complete", { text: full, persisted_turn: { final_assistant_row_id: 51 } });
    await settle();
    unsubscribe();
    results[`stream${interval}`] = {
      intervalMs: interval,
      replyChars: full.length,
      deltas: REPLY_DELTAS,
      ...writes(since(start)),
      emissions,
      liveEmissions,
      liveChars,
    };
  });

it("send to acknowledgement", async () => {
  vi.useFakeTimers();
  const { manager } = await setup();
  active = manager;
  const id = sid(0);
  await manager.openSession(id);
  await settle();
  const start = h.log.length;
  const sending = manager.send(id, "Please summarise the last answer in one line.");
  await settle();
  await sending;
  const window = since(start);
  const submitAt = window.findIndex((e) => e.kind === "rpc" && e.method === "prompt.submit");
  const ackAt = window.findIndex((e) => e.kind === "ack");
  if (submitAt < 0 || ackAt < 0) throw new Error("send did not reach acknowledgement");
  results.send = {
    before: writes(window.slice(0, submitAt)),
    after: writes(window.slice(submitAt, ackAt)),
    afterAck: writes(window.slice(ackAt)),
  };
});

it("open chats", async () => {
  vi.useFakeTimers();
  const { manager } = await setup();
  active = manager;
  // A chat in the inventory but not cached or attached: the client must send session.resume.
  let start = h.log.length;
  await manager.openSession(sid(CACHED_CHATS + 2));
  let window = since(start);
  const resumeAt = window.findIndex((e) => e.kind === "rpc" && e.method === "session.resume");
  if (resumeAt < 0) throw new Error("uncached open did not resume");
  results.openUncached = writes(window.slice(0, resumeAt));
  await settle();
  // A recent cached chat: reconnect already attached it, so the client answers from memory.
  manager.goHome();
  await settle();
  start = h.log.length;
  await manager.openSession(sid(3));
  window = since(start);
  const openAt = window.findIndex((e) => e.kind === "open");
  if (openAt < 0) throw new Error("cached open did not reach the client");
  results.openCached = {
    ...writes(window.slice(0, openAt)),
    resumed: (window[openAt] as any).resumed,
  };
  await settle();
});

it("typing into a draft", async () => {
  vi.useFakeTimers();
  const { manager } = await setup();
  active = manager;
  const id = sid(0);
  await manager.openSession(id);
  await settle();
  const typed = "The quick brown fox jumps over the lazy dog while the benchmark counts writes.."
    .padEnd(TYPED_CHARS, ".")
    .slice(0, TYPED_CHARS);
  let emissions = 0,
    draftChanges = 0,
    drafts = manager.getState().drafts;
  const unsubscribe = manager.subscribe(() => {
    emissions++;
    if (manager.getState().drafts !== drafts) {
      draftChanges++;
      drafts = manager.getState().drafts;
    }
  });
  const start = h.log.length;
  for (let n = 1; n <= TYPED_CHARS; n++) {
    manager.setDraft(id, typed.slice(0, n));
    await vi.advanceTimersByTimeAsync(KEY_INTERVAL_MS);
  }
  await settle();
  unsubscribe();
  results.typing = { keystrokes: TYPED_CHARS, ...writes(since(start)), emissions, draftChanges };
});
