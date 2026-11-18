import { expect } from "vitest";
import { CanonicalClient, type ClientOptions, type SocketLike } from "../src/index.js";

export type Frame = Record<string, any>;
export const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
export const snapshot = (id = "s", revision = 1, sequence = 0) => ({
  session_id: id,
  subscription_id: `sub-${id}`,
  replay_epoch: "epoch",
  last_sequence: sequence,
  revision,
  execution_generation: 2,
  messages: [],
  running: false,
  pending: [],
  prompts: [],
  info: {},
});

export class FakeSocket implements SocketLike {
  readyState = 1;
  protocol = "hermes-gateway-v1";
  listeners = new Map<string, Array<(event: any) => void>>();
  sent: Frame[] = [];
  constructor(
    readonly server: FakeServer,
    readonly protocols: string[],
  ) {
    queueMicrotask(() =>
      this.event({
        type: "gateway.ready",
        payload: {
          session_authority: server.authority,
          heartbeat: server.heartbeat,
          replay_epoch: "epoch",
        },
      }),
    );
  }
  addEventListener(type: "message" | "close" | "error", listener: (event: any) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }
  emit(type: string, value: any): void {
    for (const fn of this.listeners.get(type) ?? []) fn(value);
  }
  event(params: Frame): void {
    this.frame({ jsonrpc: "2.0", method: "event", params });
  }
  frame(frame: Frame): void {
    if (this.readyState === 1) this.emit("message", { data: JSON.stringify(frame) });
  }
  send(data: string): void {
    if (this.readyState !== 1) throw new Error("socket closed");
    const frame = JSON.parse(data) as Frame;
    this.sent.push(frame);
    this.server.receive(this, frame);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code: 1006 });
  }
}
export class FakeServer {
  sockets: FakeSocket[] = [];
  tickets = 0;
  authority = true;
  heartbeat = true;
  respondPings = true;
  replay: Frame[] = [];
  snapshotRequired = false;
  currentSnapshot = snapshot();
  calls: Frame[] = [];
  custom?: (socket: FakeSocket, frame: Frame) => boolean;
  fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer hidden");
    this.tickets++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ ticket: `ticket${this.tickets}` }),
    } as Response;
  }) as typeof fetch;
  factory = (_url: string, protocols: string[]) => {
    const socket = new FakeSocket(this, protocols);
    this.sockets.push(socket);
    return socket;
  };
  receive(socket: FakeSocket, frame: Frame): void {
    if (!frame.method) return;
    this.calls.push(frame);
    if (this.custom?.(socket, frame)) return;
    if (frame.method === "gateway.ping" && !this.respondPings) return;
    const result: Record<string, unknown> = {
      "client.capabilities": { server_requests: [], declines_not_shown: true },
      "runtime.describe": {
        capabilities: ["event-replay-v1"],
        session_create: {
          sources: ["gui"],
          parameters: ["request_id", "source", "client", "title"],
        },
      },
      "session.resume": { ...this.currentSnapshot, session_id: frame.params.session_id },
      "session.events.since": {
        events: this.replay,
        snapshot_required: this.snapshotRequired,
        truncated: false,
        replay_epoch: "epoch",
        last_sequence: 0,
      },
      "prompt.submit": { status: "queued", admission_id: "admission" },
      "session.mutate": { revision: 2 },
      "session.detach": { detached: true },
    };
    const answer = result[frame.method] ?? {};
    queueMicrotask(() => socket.frame({ jsonrpc: "2.0", id: frame.id, result: answer }));
  }
  get socket(): FakeSocket {
    return this.sockets[this.sockets.length - 1];
  }
  event(
    type: string,
    payload: Frame,
    seq: number,
    session_id = "s",
    execution_generation = 2,
  ): void {
    this.socket.event({
      type,
      payload,
      seq,
      session_id,
      replay_epoch: "epoch",
      execution_generation,
    });
  }
}
export function make(server: FakeServer, extra: Partial<ClientOptions> = {}): CanonicalClient {
  return new CanonicalClient({
    baseUrl: "https://host.tailnet:9120",
    getToken: async () => "hidden",
    fetch: server.fetch,
    socketFactory: server.factory,
    persistSubmission: async () => {},
    acknowledgeSubmission: async () => {},
    requestTimeoutMs: 40,
    connectTimeoutMs: 100,
    heartbeatIntervalMs: 0,
    heartbeatDeadlineMs: 0,
    backoff: () => 5,
    ...extra,
  });
}
export async function until(predicate: () => boolean, timeout = 500): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for test state");
    await sleep(5);
  }
}
