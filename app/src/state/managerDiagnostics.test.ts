import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  secure: new Map<string, string>(),
  clients: [] as any[],
  writes: [] as number[],
}));
vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock("@react-native-community/netinfo", () => ({ default: { addEventListener: vi.fn() } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => h.secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    h.secure.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    h.secure.delete(k);
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
      h.writes.push(value.length);
      h.rows.set(key, value);
    },
  }),
}));
vi.mock("@hermes-mobile/protocol", () => ({
  randomUUID: () => crypto.randomUUID(),
  JsonRpcGatewayError: class extends Error {},
  // Follows the real client's order: persist, report, send, acknowledge.
  CanonicalClient: class {
    opts: any;
    connectionState = "offline";
    constructor(opts: any) {
      this.opts = opts;
      h.clients.push(this);
    }
    async connect() {
      this.opts.onState?.("connecting");
      this.connectionState = "ready";
      this.opts.onState?.("ready");
    }
    async openSession(session_id: string) {
      return { session_id, execution_generation: 1 };
    }
    async request(method: string) {
      return method === "session.list"
        ? { sessions: [] }
        : method === "session.transcript"
          ? { rows: [] }
          : {};
    }
    async submit(item: any) {
      await this.opts.persistSubmission(item);
      this.opts.onSubmitSent?.(item);
      await this.opts.acknowledgeSubmission(item, { admission_id: `adm-${item.submission_id}` });
    }
    async detachSession() {}
    close() {}
    async reconnectNow() {}
    getSession() {
      return { execution_generation: 1 };
    }
  },
}));
vi.mock("../notifications", () => ({
  notifyEvent: vi.fn(async () => {}),
  reconcileSnapshot: vi.fn(async () => {}),
}));
import { AppManager } from "./index";
import { conversationDiagnostics } from "./conversationDiagnostics";

const flush = async () => {
  for (let n = 0; n < 10; n++) await new Promise((r) => setTimeout(r, 0));
};
const ORIGIN = "https://example.test";
async function connected() {
  const manager = new AppManager();
  await manager.initialize();
  await flush();
  return { manager, client: h.clients.at(-1) };
}
const stages = () => conversationDiagnostics.export().map((e) => [e.trace, e.stage]);
const delta = (client: any, session: string, admission: string, text: string) =>
  client.opts.onEvent({
    type: "message.delta",
    session_id: session,
    admission_id: admission,
    payload: { text },
  });

beforeEach(() => {
  h.rows = new Map();
  h.secure = new Map([
    ["hermes.config.v1", JSON.stringify({ version: 1, origin: ORIGIN, token: "secret" })],
  ]);
  h.clients = [];
  h.writes = [];
  conversationDiagnostics.setEnabled(false);
});
afterEach(() => conversationDiagnostics.setEnabled(false));

describe("conversation trace stages", () => {
  it("marks submit_sent and first_delta once on a typed send, between saved and complete", async () => {
    const { manager, client } = await connected();
    conversationDiagnostics.setEnabled(true);
    const submission = (await manager.send("s", "private words"))!;
    await flush();
    const admission = `adm-${submission}`;
    delta(client, "other-session", admission, "private");
    delta(client, "s", "other-admission", "private");
    expect(stages().map(([, stage]) => stage)).toEqual([
      "submission_start",
      "submission_saved",
      "submit_sent",
    ]);
    delta(client, "s", admission, "private answer");
    delta(client, "s", admission, " continues");
    client.opts.onEvent({
      type: "message.complete",
      session_id: "s",
      admission_id: admission,
      payload: { text: "private answer continues", persisted_turn: { submission_id: submission } },
    });
    delta(client, "s", admission, "late");
    const events = conversationDiagnostics.export();
    expect(events.map((e) => e.stage)).toEqual([
      "submission_start",
      "submission_saved",
      "submit_sent",
      "first_delta",
      "reply_complete",
    ]);
    expect(new Set(events.map((e) => e.trace)).size).toBe(1);
    expect(JSON.stringify(conversationDiagnostics.report())).not.toMatch(/private|adm-|"s"/);
    manager.dispose();
  });

  it("marks a caller-owned voice trace without completing or ending it", async () => {
    const { manager, client } = await connected();
    conversationDiagnostics.setEnabled(true);
    const trace = conversationDiagnostics.begin();
    const submission = (await manager.send("s", "spoken words", undefined, {
      preserveDraft: true,
      diagnosticTrace: trace,
    }))!;
    await flush();
    delta(client, "s", `adm-${submission}`, "reply");
    client.opts.onEvent({
      type: "message.complete",
      session_id: "s",
      payload: { text: "reply", persisted_turn: { submission_id: submission } },
    });
    expect(stages()).toEqual([
      [trace, "submit_sent"],
      [trace, "first_delta"],
    ]);
    // The voice sheet still owns the trace: its later stages are recorded.
    conversationDiagnostics.mark(trace, "reply_complete");
    conversationDiagnostics.mark(trace, "tts_request_start");
    expect(stages().map(([, stage]) => stage)).toEqual([
      "submit_sent",
      "first_delta",
      "reply_complete",
      "tts_request_start",
    ]);
    manager.dispose();
  });
});

describe("duration samples", () => {
  it("records persist, open, connect and cache restore durations without content", async () => {
    h.rows.set(
      `state:${ORIGIN}`,
      JSON.stringify({ version: 1, origin: ORIGIN, payload: { drafts: { s: "private draft" } } }),
    );
    conversationDiagnostics.setEnabled(true);
    const { manager } = await connected();
    await manager.openSession("s");
    await flush();
    const samples = conversationDiagnostics.report().samples;
    const names = samples.map((s) => s.name);
    expect(names.filter((n) => n === "cache_restore_ms")).toHaveLength(1);
    expect(names.filter((n) => n === "connect_ready_ms")).toHaveLength(1);
    expect(names.filter((n) => n === "session_open_ms")).toHaveLength(1);
    const persists = samples.filter((s) => s.name === "persist_ms");
    expect(persists.map((s) => s.chars)).toEqual(h.writes);
    for (const sample of samples) {
      expect(Number.isFinite(sample.ms) && sample.ms >= 0).toBe(true);
      expect(Object.keys(sample).every((k) => ["name", "ms", "chars"].includes(k))).toBe(true);
    }
    expect(JSON.stringify(samples)).not.toMatch(/private|example|"s"/);
    manager.dispose();
  });

  it("records nothing while disabled, even when handed a trace number", async () => {
    const { manager, client } = await connected();
    await manager.openSession("s");
    const submission = (await manager.send("s", "words", undefined, {
      preserveDraft: true,
      diagnosticTrace: 7,
    }))!;
    await manager.send("s", "typed");
    await flush();
    delta(client, "s", `adm-${submission}`, "reply");
    client.opts.onEvent({
      type: "message.complete",
      session_id: "s",
      payload: { text: "reply", persisted_turn: { submission_id: submission } },
    });
    await flush();
    expect((manager as any).diagnosticSubmissions.size).toBe(0);
    conversationDiagnostics.setEnabled(true);
    expect(conversationDiagnostics.report()).toEqual({
      events: [],
      samples: [],
      renders: { chat_screen: 0, timeline_item: 0, live_message: 0, message_input: 0 },
    });
    manager.dispose();
  });
});
