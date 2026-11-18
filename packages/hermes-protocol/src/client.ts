import {
  JsonRpcGatewayError,
  JsonRpcRequestChannel,
  wireFrameText,
  type ServerRequest,
} from "./vendor/json-rpc-channel.js";
import { reconnectBackoffDelayMs, isStableOpen } from "./vendor/reconnect-backoff.js";
import { randomUUID } from "./uuid.js";
import type { GatewayEvent } from "./vendor/gateway-events.js";
import type { CanonicalRpcMethods } from "./vendor/gateway-contract.generated.js";

export type ConnectionState =
  "offline" | "connecting" | "ready" | "reconnecting" | "auth-failed" | "incompatible";
export interface SocketLike {
  readonly readyState: number;
  readonly protocol: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close" | "error", listener: (event: { code?: number }) => void): void;
}
export interface Snapshot {
  session_id: string;
  subscription_id: string;
  replay_epoch: string;
  last_sequence: number;
  revision: number;
  execution_generation: number;
  [key: string]: unknown;
}
export interface Replay {
  events: GatewayEvent[];
  snapshot_required: boolean;
  truncated: boolean;
  replay_epoch: string;
  last_sequence: number;
}
export interface RuntimeDescription {
  capabilities: string[];
  session_create: { sources: string[]; parameters: string[] };
  [key: string]: unknown;
}
export interface PendingSubmission {
  session_id: string;
  submission_id: string;
  text: string;
  attachments?: Array<{ path: string; mime: string }>;
}
export interface ClientOptions {
  baseUrl: string;
  /** Credentials remain in the secure caller, never in logs or event payloads. */
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
  socketFactory?: (url: string, protocols: string[]) => SocketLike;
  onState?: (state: ConnectionState) => void;
  onEvent?: (event: GatewayEvent) => void;
  onSnapshot?: (sessionId: string, snapshot: Snapshot, reason: "resume" | "rebuild") => void;
  /** A previously open session was definitively unavailable during reconnect. */
  onSessionUnavailable?: (sessionId: string, detail: { reason: "not_found"; code: number }) => void;
  /** An active turn's earlier streamed text is unavailable after a gap. The
   * following delta retains its original non-zero offset; do not claim the
   * visible stream is complete until the authoritative completion arrives. */
  onPartialUnavailable?: (
    sessionId: string,
    info: { turn: string; segment: number; offset: number },
  ) => void;
  /** The caller must durably save this before resolving. Keep it on failures. */
  persistSubmission: (submission: PendingSubmission) => Promise<void>;
  acknowledgeSubmission: (submission: PendingSubmission, receipt: unknown) => Promise<void>;
  /** The UI owns the input. AbortSignal fires on request.cancel or connection loss. */
  requestSecret?: (
    method: "sudo" | "secret",
    params: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<string>;
  /** Identity reported in session.create; defaults to the protocol SDK identity. */
  clientIdentity?: { name: string; version: string };
  createId?: () => string;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatDeadlineMs?: number;
  backoff?: (attempt: number) => number;
}
type RecordValue = Record<string, unknown>;
interface SessionState {
  id: string;
  cursor: number;
  replayEpoch: string | null;
  revision: number;
  generation: number;
  snapshot?: Snapshot;
  hold: GatewayEvent[] | null;
  rebuilding?: Promise<void>;
  cancelled: boolean;
  opening?: Promise<Snapshot>;
  pendingResume?: { promise: Promise<Snapshot>; generation: number };
  subscriptionGeneration?: number;
  release?: { key: string; promise: Promise<void> };
  allowMissingPrefix: boolean;
  /** Per turn+segment text, in UTF-16 units, retained across reconnects. */
  segments: Map<string, { start: number; text: string }>;
  completedTurns: Set<string>;
}
class SessionDetachedError extends Error {
  constructor() {
    super("Session was detached");
  }
}
const bridge = /^(?:preview\.|terminal\.read$|window\.read$|tour$|theme\.|vault\.|setup_beat$)/;
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" ? (value as RecordValue) : {};
const numeric = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One singleton-style client per configured endpoint. Call close() on teardown. */
export class CanonicalClient {
  private readonly opts: ClientOptions;
  private readonly base: URL;
  private readonly channel: JsonRpcRequestChannel;
  private readonly sessions = new Map<string, SessionState>();
  private readonly aliases = new Map<string, string>();
  private unboundEvents: GatewayEvent[] = [];
  private readonly unresolvedDetached = new Set<SessionState>();
  private readonly serverRequests = new Map<string, AbortController>();
  /** A resolved-owner ID is not known until resume returns. While a detach is
   * unresolved, serialize new opens so the old cleanup cannot release a new
   * acquisition on the same socket, even through a different stored alias. */
  private readonly detachments = new Set<Promise<void>>();
  private socket: SocketLike | null = null;
  private desired = false;
  private generation = 0;
  private attempt = 0;
  private openedAt: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ticketController: AbortController | null = null;
  private connecting: Promise<void> | null = null;
  private readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  private state: ConnectionState = "offline";
  private descriptor?: RuntimeDescription;

  constructor(options: ClientOptions) {
    this.opts = options;
    this.base = new URL(options.baseUrl);
    if (
      this.base.protocol !== "https:" ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      (this.base.pathname !== "/" && this.base.pathname !== "")
    ) {
      throw new Error(
        "Gateway base URL must be an HTTPS origin without credentials, path, query, or fragment",
      );
    }
    this.channel = new JsonRpcRequestChannel({
      requestTimeoutMs: options.requestTimeoutMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      heartbeatDeadlineMs: options.heartbeatDeadlineMs,
      heartbeatLiveness: "any-inbound",
      onHeartbeatFailure: () => this.socket?.close(),
      onEvent: (event) => this.handleEvent(event),
    });
    this.channel.onRequest((request) => this.handleServerRequest(request));
  }

  get connectionState(): ConnectionState {
    return this.state;
  }
  get runtime(): RuntimeDescription | undefined {
    return this.descriptor;
  }
  getSession(id: string): Snapshot | undefined {
    return this.sessions.get(this.aliases.get(id) ?? id)?.snapshot;
  }
  private setState(state: ConnectionState): void {
    if (state !== this.state) {
      this.state = state;
      this.opts.onState?.(state);
    }
    if (state === "auth-failed" || state === "incompatible") {
      for (const waiter of this.readyWaiters) waiter.reject(new Error(`Gateway ${state}`));
      this.readyWaiters.clear();
    }
  }
  private id(): string {
    return this.opts.createId?.() ?? randomUUID();
  }

  /** Initial connection resolves only after canonical authority and capability checks. */
  async connect(): Promise<void> {
    this.desired = true;
    if (this.state === "ready") return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.connecting) return this.connecting;
    this.setState(this.attempt ? "reconnecting" : "connecting");
    const work = this.dial();
    this.connecting = work;
    try {
      await work;
    } catch (error) {
      if (this.desired && this.state !== "incompatible" && this.state !== "auth-failed")
        this.scheduleReconnect();
      throw error;
    } finally {
      if (this.connecting === work) this.connecting = null;
    }
  }

  private async dial(): Promise<void> {
    const generation = ++this.generation;
    const token = await this.opts.getToken();
    if (!this.desired || generation !== this.generation) throw new Error("Connection cancelled");
    const controller = new AbortController();
    this.ticketController = controller;
    const ticketTimer = setTimeout(() => controller.abort(), this.opts.connectTimeoutMs ?? 15_000);
    let payload: RecordValue;
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("WebSocket ticket request cancelled or timed out")),
          { once: true },
        );
      });
      const receiveTicket = async () => {
        const response = await (this.opts.fetch ?? fetch)(
          new URL("/api/auth/ws-ticket", this.base).toString(),
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          if (
            !controller.signal.aborted &&
            generation === this.generation &&
            (response.status === 401 || response.status === 403)
          )
            this.setState("auth-failed");
          throw new Error(`WebSocket ticket request failed (${response.status})`);
        }
        return object(await response.json());
      };
      payload = await Promise.race([receiveTicket(), cancelled]);
    } finally {
      clearTimeout(ticketTimer);
      if (this.ticketController === controller) this.ticketController = null;
    }
    if (typeof payload.ticket !== "string" || !payload.ticket)
      throw new Error("WebSocket ticket response was invalid");
    if (!this.desired || generation !== this.generation) throw new Error("Connection cancelled");
    const url = new URL("/api/ws", this.base);
    url.protocol = "wss:";
    const socket: SocketLike = (
      this.opts.socketFactory ??
      ((address, protocols) => new WebSocket(address, protocols) as unknown as SocketLike)
    )(url.toString(), ["hermes-gateway-v1", `hermes-gateway-ticket.${payload.ticket}`]);
    this.socket = socket;
    this.channel.attach({ send: (text) => socket.send(text) });
    let resolveReady!: (event: GatewayEvent) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<GatewayEvent>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    let gotReady = false;
    const timer = setTimeout(
      () => rejectReady(new Error("Gateway ready timed out")),
      this.opts.connectTimeoutMs ?? 15_000,
    );
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation || this.socket !== socket) return;
      const raw = wireFrameText(event.data);
      if (raw === null) return;
      if (!gotReady) {
        let frame: RecordValue;
        try {
          frame = object(JSON.parse(raw));
        } catch {
          rejectReady(new Error("Invalid gateway frame"));
          return;
        }
        const params = object(frame.params);
        if (frame.method !== "event" || params.type !== "gateway.ready") {
          rejectReady(new Error("First gateway frame was not gateway.ready"));
          return;
        }
        gotReady = true;
        if (object(params.payload).session_authority !== true) {
          this.setState("incompatible");
          rejectReady(new Error("Gateway has no session authority"));
          return;
        }
        if (socket.protocol !== "hermes-gateway-v1") {
          this.setState("incompatible");
          rejectReady(new Error("Gateway selected an incompatible protocol"));
          return;
        }
        this.channel.handleFrame(raw);
        resolveReady(params as unknown as GatewayEvent);
        return;
      }
      this.channel.handleFrame(raw);
    });
    const lost = () => {
      if (generation !== this.generation || this.socket !== socket) return;
      rejectReady(new Error("Gateway connection closed"));
      this.socket = null;
      this.channel.detach(new Error("Gateway connection lost"));
      this.unboundEvents = [];
      this.abortServerRequests();
      socket.close();
      if (this.desired && this.state !== "incompatible" && this.state !== "auth-failed") {
        if (isStableOpen(this.openedAt)) this.attempt = 0;
        this.openedAt = null;
        this.scheduleReconnect();
      }
    };
    socket.addEventListener("close", lost);
    socket.addEventListener("error", lost);
    try {
      const first = await ready;
      if (object(first.payload).heartbeat === true) this.channel.startHeartbeat();
      // The vendored channel advertises capabilities upon gateway.ready. This explicit
      // call observes acceptance before any session work rather than assuming it.
      await this.channel.request("client.capabilities", { server_requests: true });
      const description = await this.channel.request<RuntimeDescription>("runtime.describe", {});
      if (
        !Array.isArray(description?.capabilities) ||
        !Array.isArray(description?.session_create?.parameters) ||
        !Array.isArray(description?.session_create?.sources)
      )
        throw new Error("Invalid runtime description");
      this.descriptor = description;
      for (const session of this.sessions.values()) await this.recoverSession(session, generation);
      if (!this.desired || generation !== this.generation || this.socket !== socket)
        throw new Error("Connection cancelled");
      this.openedAt = Date.now();
      this.setState("ready");
      for (const waiter of this.readyWaiters) waiter.resolve();
      this.readyWaiters.clear();
    } catch (error) {
      if (generation === this.generation) {
        this.channel.detach(new Error("Gateway connection lost"));
        this.socket = null;
        socket.close();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Immediately fence frames even if the platform closes the socket asynchronously. */
  private retireSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    this.channel.detach(new Error("Gateway connection lost"));
    this.unboundEvents = [];
    this.abortServerRequests();
    socket.close();
    if (this.desired && this.state !== "incompatible" && this.state !== "auth-failed") {
      if (isStableOpen(this.openedAt)) this.attempt = 0;
      this.openedAt = null;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (
      !this.desired ||
      this.retryTimer ||
      this.state === "incompatible" ||
      this.state === "auth-failed"
    )
      return;
    this.setState("reconnecting");
    const wait = Math.max(0, (this.opts.backoff ?? reconnectBackoffDelayMs)(this.attempt++));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // An earlier dial's finally must have cleared its in-flight promise first.
      void this.connect().catch(() => undefined);
    }, wait);
  }

  close(): void {
    this.desired = false;
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ticketController?.abort();
    this.ticketController = null;
    const socket = this.socket;
    this.socket = null;
    this.channel.detach(new Error("Gateway closed"));
    this.unboundEvents = [];
    this.abortServerRequests();
    socket?.close();
    this.setState("offline");
    for (const waiter of this.readyWaiters) waiter.reject(new Error("Gateway closed"));
    this.readyWaiters.clear();
  }

  /** Call on app foreground/network change to bypass an existing retry delay. */
  reconnectNow(): Promise<void> {
    if (!this.desired) return this.connect();
    if (this.state === "ready") return Promise.resolve();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    return this.connect();
  }

  private waitForReady(): Promise<void> {
    if (this.state === "ready") return Promise.resolve();
    if (!this.desired || this.state === "auth-failed" || this.state === "incompatible")
      return Promise.reject(new Error("Gateway is not available"));
    return new Promise((resolve, reject) => this.readyWaiters.add({ resolve, reject }));
  }

  async request<T>(method: string, params: RecordValue = {}, timeoutMs?: number): Promise<T> {
    if (this.state !== "ready") throw new Error("Gateway is not ready");
    return this.channel.request<T>(method, params, timeoutMs);
  }

  /** Typed RPC entry point tied to the vendored generated canonical contract. */
  async rpc<K extends keyof CanonicalRpcMethods>(
    method: K,
    params: CanonicalRpcMethods[K]["params"],
    timeoutMs?: number,
  ): Promise<CanonicalRpcMethods[K]["result"]> {
    return this.request<CanonicalRpcMethods[K]["result"]>(method, params as RecordValue, timeoutMs);
  }

  async createSession(options: RecordValue = {}): Promise<Snapshot> {
    const contract = this.descriptor?.session_create;
    if (!contract?.sources.includes("gui"))
      throw new Error("Gateway does not support GUI sessions");
    const params: RecordValue = { ...options, source: "gui", request_id: this.id() };
    if (contract.parameters.includes("client"))
      params.client = this.opts.clientIdentity ?? { name: "hermes-mobile", version: "0.1.0" };
    for (const key of Object.keys(params))
      if (!contract.parameters.includes(key)) throw new Error(`Unsupported create option: ${key}`);
    return this.request<Snapshot>("session.create", params);
  }

  async openSession(id: string): Promise<Snapshot> {
    if (!id) throw new Error("Session ID required");
    if (this.state !== "ready") throw new Error("Gateway is not ready");
    // A detached stored tip may resolve to any owner until its pending resume
    // answers. Waiting globally here preserves ownership even for an open via
    // that owner ID; normally this only waits for one short detach RPC.
    while (this.detachments.size) await Promise.allSettled([...this.detachments]);
    if (this.state !== "ready") await this.waitForReady();
    id = this.aliases.get(id) ?? id;
    const existing = this.sessions.get(id);
    if (existing?.opening) return existing.opening;
    if (existing?.snapshot && !existing.rebuilding) return existing.snapshot;
    const session: SessionState = existing ?? {
      id,
      cursor: 0,
      replayEpoch: null,
      revision: 0,
      generation: 0,
      hold: [],
      cancelled: false,
      allowMissingPrefix: false,
      segments: new Map(),
      completedTurns: new Set(),
    };
    this.sessions.set(id, session);
    session.hold = [];
    const opening = this.finishOpen(session, !!existing);
    session.opening = opening;
    try {
      return await opening;
    } finally {
      if (session.opening === opening) session.opening = undefined;
    }
  }

  /** Fresh authority snapshot for actions that must not trust a cached prompt. */
  async refreshSession(id: string): Promise<Snapshot> {
    const generation = this.generation;
    await this.openSession(id);
    id = this.aliases.get(id) ?? id;
    const session = this.sessions.get(id);
    if (!session || session.cancelled || generation !== this.generation || this.state !== "ready")
      throw new Error("Session is unavailable");
    if (session.opening) return session.opening;
    if (session.rebuilding) await session.rebuilding;
    if (
      session.cancelled ||
      generation !== this.generation ||
      this.state !== "ready" ||
      this.sessions.get(session.id) !== session
    )
      throw new Error("Session is unavailable");
    if (session.opening) return session.opening;
    session.hold = [];
    const work = this.finishOpen(session, true);
    session.opening = work;
    try {
      return await work;
    } finally {
      if (session.opening === work) session.opening = undefined;
    }
  }

  private async finishOpen(session: SessionState, existing: boolean): Promise<Snapshot> {
    const previousCursor = session.cursor;
    const previousEpoch = session.replayEpoch;
    const socketGeneration = this.generation;
    try {
      const snapshot = await this.resumeSnapshot(session);
      const reconstruct = !existing || previousEpoch !== snapshot.replay_epoch;
      this.applySnapshot(session, snapshot, reconstruct && existing ? "rebuild" : "resume");
      this.routeUnboundEvents();
      // Refresh keeps the consumer's current baseline and only replays newer
      // events. Initial joins (and changed epochs) reconstruct from the ring.
      if (snapshot.running === true || (!reconstruct && previousCursor < snapshot.last_sequence)) {
        const cursor = reconstruct ? 0 : previousCursor;
        const replay = await this.channel.request<Replay>("session.events.since", {
          session_id: session.id,
          last_sequence: cursor,
          replay_epoch: snapshot.replay_epoch,
        } satisfies CanonicalRpcMethods["session.events.since"]["params"]);
        if (session.cancelled) throw new SessionDetachedError();
        if (
          !Array.isArray(replay?.events) ||
          typeof replay.snapshot_required !== "boolean" ||
          typeof replay.truncated !== "boolean" ||
          typeof replay.replay_epoch !== "string" ||
          !numeric(replay.last_sequence)
        )
          throw new Error("Invalid replay response");
        if (
          !replay.snapshot_required &&
          !replay.truncated &&
          replay.replay_epoch === snapshot.replay_epoch
        ) {
          session.cursor = cursor;
          for (const event of replay.events)
            if (!reconstruct || event.execution_generation === snapshot.execution_generation)
              this.applyEvent(event);
        } else {
          session.allowMissingPrefix = true;
          this.opts.onEvent?.({
            type: "session.replay_gap",
            session_id: session.id,
            payload: { replay_epoch: replay.replay_epoch },
          });
        }
      } else if (!reconstruct) session.cursor = previousCursor;
      if (session.cancelled) throw new SessionDetachedError();
      this.flushHold(session);
      session.cursor = Math.max(session.cursor, snapshot.last_sequence);
      return snapshot;
    } catch (error) {
      // Resume may have acquired a subscription even when its reply was lost,
      // malformed, or later replay failed. Retire that socket before dropping
      // ownership; closing also prevents unfenced events from that acquisition.
      if (
        !(error instanceof SessionDetachedError) &&
        socketGeneration === this.generation &&
        this.channel.connected
      )
        this.retireSocket();
      if (!existing && this.sessions.get(session.id) === session) {
        this.sessions.delete(session.id);
        this.unboundEvents = this.unboundEvents.filter((event) => event.session_id !== session.id);
      } else {
        session.hold = null;
        // A failed refresh must reconnect from the last delivered event, not
        // the newer snapshot watermark that was never replayed.
        session.cursor = previousCursor;
        session.replayEpoch = previousEpoch;
      }
      this.routeUnboundEvents();
      throw error;
    }
  }

  async detachSession(id: string): Promise<void> {
    id = this.aliases.get(id) ?? id;
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    if (!session) return;
    session.cancelled = true;
    session.hold = null;
    const pending = session.pendingResume;
    if (pending) this.unresolvedDetached.add(session);
    // Register before any asynchronous cleanup or callback can open a new
    // view. Deferred execution also prevents a re-entrant event callback from
    // racing ahead of the barrier registration.
    const detaching = Promise.resolve().then(() => this.finishDetach(session, pending));
    this.detachments.add(detaching);
    try {
      await detaching;
    } finally {
      this.detachments.delete(detaching);
    }
  }

  private async finishDetach(
    session: SessionState,
    pending: SessionState["pendingResume"],
  ): Promise<void> {
    if (pending) {
      try {
        const snapshot = await pending.promise;
        if (!this.sessions.has(snapshot.session_id))
          this.unboundEvents = this.unboundEvents.filter(
            (event) => event.session_id !== snapshot.session_id,
          );
        await this.releaseSnapshot(session, snapshot, pending.generation);
      } catch (error) {
        // If a resume times out on a still-live socket, its server-side
        // subscription may have committed without a reply. Closing that socket
        // is the only way to ensure the abandoned subscription is released.
        if (pending.generation === this.generation && this.channel.connected) this.socket?.close();
        throw error;
      } finally {
        this.unresolvedDetached.delete(session);
        this.routeUnboundEvents();
      }
    } else if (session.snapshot && session.subscriptionGeneration !== undefined) {
      this.routeUnboundEvents();
      try {
        await this.releaseSnapshot(session, session.snapshot, session.subscriptionGeneration);
      } catch (error) {
        if (session.subscriptionGeneration === this.generation && this.channel.connected)
          this.socket?.close();
        throw error;
      }
    } else this.routeUnboundEvents();
  }

  /** Release exactly the returned subscription on the socket that acquired it. */
  private releaseSnapshot(
    session: SessionState,
    snapshot: Snapshot,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation || !this.channel.connected) return Promise.resolve();
    const key = `${generation}:${snapshot.session_id}:${snapshot.subscription_id}`;
    if (session.release?.key === key) return session.release.promise;
    const release = this.channel
      .request("session.detach", {
        session_id: snapshot.session_id,
        subscription_id: snapshot.subscription_id,
      })
      .then(() => undefined);
    session.release = { key, promise: release };
    return release;
  }

  private async resumeSnapshot(session: SessionState): Promise<Snapshot> {
    const generation = this.generation;
    const promise = this.channel.request<Snapshot>("session.resume", {
      session_id: session.id,
      display_projection: true,
    } satisfies CanonicalRpcMethods["session.resume"]["params"]);
    session.pendingResume = { promise, generation };
    try {
      const snapshot = await promise;
      if (session.cancelled) {
        await this.releaseSnapshot(session, snapshot, generation);
        throw new SessionDetachedError();
      }
      return snapshot;
    } finally {
      if (session.pendingResume?.promise === promise) session.pendingResume = undefined;
    }
  }

  private applySnapshot(
    session: SessionState,
    snapshot: Snapshot,
    reason: "resume" | "rebuild",
  ): void {
    if (session.cancelled) throw new SessionDetachedError();
    if (
      !snapshot ||
      typeof snapshot.session_id !== "string" ||
      !snapshot.session_id ||
      typeof snapshot.subscription_id !== "string" ||
      typeof snapshot.replay_epoch !== "string" ||
      !numeric(snapshot.last_sequence) ||
      !numeric(snapshot.revision) ||
      !numeric(snapshot.execution_generation)
    )
      throw new Error("Invalid session snapshot");
    // Stored compression tips and platform continuations can resolve to their
    // authority's logical owner; use the returned ID for every later RPC.
    if (snapshot.session_id !== session.id) {
      const previous = session.id;
      const other = this.sessions.get(snapshot.session_id);
      if (other && other !== session) throw new Error("Resolved session is already open");
      this.sessions.delete(previous);
      for (const [alias, target] of this.aliases)
        if (target === previous) this.aliases.set(alias, snapshot.session_id);
      this.aliases.set(previous, snapshot.session_id);
      session.id = snapshot.session_id;
      this.sessions.set(session.id, session);
    }
    session.snapshot = snapshot;
    session.subscriptionGeneration = this.generation;
    // This is a new acquisition even when the authority reused its ID.
    session.release = undefined;
    session.cursor = snapshot.last_sequence;
    session.replayEpoch = snapshot.replay_epoch;
    session.revision = snapshot.revision;
    session.generation = snapshot.execution_generation;
    if (reason === "rebuild") {
      session.segments.clear();
      session.completedTurns.clear();
      session.allowMissingPrefix = snapshot.running === true;
    }
    this.opts.onSnapshot?.(session.id, snapshot, reason);
  }

  private async recoverSession(session: SessionState, generation: number): Promise<void> {
    if (session.cancelled) return;
    session.hold = [];
    let rebuild = !session.replayEpoch;
    try {
      if (session.replayEpoch) {
        const replay = await this.channel.request<Replay>("session.events.since", {
          session_id: session.id,
          last_sequence: session.cursor,
          replay_epoch: session.replayEpoch,
        } satisfies CanonicalRpcMethods["session.events.since"]["params"]);
        if (session.cancelled) return;
        if (!Array.isArray(replay?.events)) throw new Error("Invalid replay response");
        rebuild =
          replay.snapshot_required === true ||
          replay.truncated === true ||
          replay.replay_epoch !== session.replayEpoch;
        if (!rebuild) for (const event of replay.events) this.applyEvent(event);
      }
      if (generation !== this.generation) throw new Error("Connection changed during replay");
      const snapshot = await this.resumeSnapshot(session);
      // The authority catches up events published after events.since during attach.
      // They can arrive before the resume response and therefore sit in hold. Do
      // not jump over those frames to snapshot.last_sequence before flushing them.
      const replayedCursor = session.cursor;
      this.applySnapshot(session, snapshot, rebuild ? "rebuild" : "resume");
      if (!rebuild) session.cursor = replayedCursor;
      this.flushHold(session);
      if (session.rebuilding) await session.rebuilding;
    } catch (error) {
      session.hold = null;
      if (error instanceof SessionDetachedError) return;
      // Only the gateway's structured, specific not-found refusal proves this
      // session is gone. Other RPC, protocol and transport failures must still
      // fail the dial and follow the normal reconnect policy.
      if (
        error instanceof JsonRpcGatewayError &&
        (error.code === 4001 || error.code === 4004) &&
        object(error.data).reason === "not_found"
      ) {
        if (session.cancelled) return;
        if (generation !== this.generation || this.sessions.get(session.id) !== session)
          throw error;
        this.sessions.delete(session.id);
        session.cancelled = true;
        for (const [alias, target] of this.aliases)
          if (target === session.id) this.aliases.delete(alias);
        this.unboundEvents = this.unboundEvents.filter((event) => event.session_id !== session.id);
        this.routeUnboundEvents();
        this.opts.onSessionUnavailable?.(session.id, { reason: "not_found", code: error.code });
        return;
      }
      throw error;
    }
  }

  private flushHold(session: SessionState): void {
    const held = session.hold ?? [];
    session.hold = null;
    held.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    for (const event of held) this.applyEvent(event);
  }

  private handleEvent(event: GatewayEvent): void {
    if (event.type === "request.cancel") {
      const id = object(event.payload).id;
      if (typeof id === "string") {
        this.serverRequests.get(id)?.abort();
        this.serverRequests.delete(id);
      }
    }
    const session = event.session_id ? this.sessions.get(event.session_id) : undefined;
    if (session?.hold) {
      session.hold.push(event);
      return;
    }
    // A resolved owner can emit events before the resume response reveals its
    // ID. Hold these until a pending initial mount can match them to its owner.
    if (
      !session &&
      event.session_id &&
      numeric(event.seq) &&
      (this.unresolvedDetached.size > 0 ||
        [...this.sessions.values()].some((s) => s.hold && !s.snapshot))
    ) {
      this.unboundEvents.push(event);
      return;
    }
    this.applyEvent(event);
  }

  private routeUnboundEvents(): void {
    const held = this.unboundEvents;
    this.unboundEvents = [];
    for (const event of held) {
      const session = event.session_id ? this.sessions.get(event.session_id) : undefined;
      if (session?.hold) session.hold.push(event);
      else if (
        !session &&
        (this.unresolvedDetached.size > 0 ||
          [...this.sessions.values()].some((s) => s.hold && !s.snapshot))
      )
        this.unboundEvents.push(event);
      else this.applyEvent(event);
    }
  }

  private applyEvent(input: GatewayEvent): void {
    const session = input.session_id ? this.sessions.get(input.session_id) : undefined;
    if (!session) {
      this.opts.onEvent?.(input);
      return;
    }
    if (input.type === "session.replay_gap") {
      this.opts.onEvent?.(input);
      if (!session.rebuilding && this.socket) {
        session.hold = [];
        const rebuilding = this.rebuild(session);
        session.rebuilding = rebuilding;
        void rebuilding
          .catch(() => this.socket?.close())
          .finally(() => {
            if (session.rebuilding === rebuilding) session.rebuilding = undefined;
          });
      }
      return;
    }
    if (
      typeof input.replay_epoch === "string" &&
      session.replayEpoch &&
      input.replay_epoch !== session.replayEpoch
    ) {
      this.handleEvent({
        type: "session.replay_gap",
        session_id: session.id,
        payload: { replay_epoch: input.replay_epoch },
      });
      return;
    }
    if (numeric(input.seq)) {
      if (input.seq <= session.cursor) return;
      session.cursor = input.seq;
    }
    const payload = object(input.payload);
    if (numeric(payload.revision)) session.revision = Math.max(session.revision, payload.revision);
    if (numeric(input.execution_generation)) session.generation = input.execution_generation;
    if (numeric(payload.execution_generation)) session.generation = payload.execution_generation;
    if (input.type === "message.start") session.allowMissingPrefix = false;
    const turn = String(payload.turn_id ?? input.admission_id ?? input.execution_generation ?? "");
    if (input.type === "message.complete") {
      session.allowMissingPrefix = false;
      for (const key of session.segments.keys())
        if (key.slice(0, key.lastIndexOf(":")) === turn) session.segments.delete(key);
      session.completedTurns.add(turn);
      if (session.completedTurns.size > 512)
        session.completedTurns.delete(session.completedTurns.values().next().value as string);
    }
    let event = input;
    if (
      input.type === "message.delta" &&
      typeof payload.text === "string" &&
      numeric(payload.segment) &&
      numeric(payload.offset)
    ) {
      if (session.completedTurns.has(turn)) return;
      const key = `${turn}:${payload.segment}`;
      const previous = session.segments.get(key);
      const start = payload.offset as number;
      if (!previous && start > 0) {
        if (!session.allowMissingPrefix) {
          this.handleEvent({ type: "session.replay_gap", session_id: session.id, payload: {} });
          return;
        }
        // The rebuild snapshot contains durable transcript rows, not the
        // active partial reply. Keep its unknown prefix explicit; continue
        // from the first available offset instead of rebuilding forever.
        session.segments.set(key, { start, text: payload.text });
        this.opts.onPartialUnavailable?.(session.id, {
          turn,
          segment: payload.segment,
          offset: start,
        });
        this.opts.onEvent?.(input);
        return;
      }
      const segment = previous ?? { start: 0, text: "" };
      const end = segment.start + segment.text.length;
      const overlapStart = Math.max(start, segment.start);
      const overlapEnd = Math.min(start + payload.text.length, end);
      if (
        start > end ||
        (overlapEnd > overlapStart &&
          segment.text.slice(overlapStart - segment.start, overlapEnd - segment.start) !==
            payload.text.slice(overlapStart - start, overlapEnd - start))
      ) {
        this.handleEvent({ type: "session.replay_gap", session_id: session.id, payload: {} });
        return;
      }
      const freshOffset = Math.max(start, end);
      const fresh = payload.text.slice(freshOffset - start);
      if (!fresh) return;
      session.segments.set(key, { start: segment.start, text: segment.text + fresh });
      if (session.segments.size > 512)
        session.segments.delete(session.segments.keys().next().value as string);
      event = {
        ...input,
        payload: { ...payload, text: fresh, offset: freshOffset },
      } as GatewayEvent;
    }
    this.opts.onEvent?.(event);
  }

  private async rebuild(session: SessionState): Promise<void> {
    try {
      if (session.cancelled) return;
      const snapshot = await this.resumeSnapshot(session);
      this.applySnapshot(session, snapshot, "rebuild");
      this.flushHold(session);
    } catch (error) {
      if (!(error instanceof SessionDetachedError)) throw error;
    }
  }

  async submit(
    submission: Omit<PendingSubmission, "submission_id"> & { submission_id?: string },
  ): Promise<unknown> {
    const id = this.aliases.get(submission.session_id) ?? submission.session_id;
    if (!this.sessions.has(id)) throw new Error("Resume the session before submitting");
    const pending: PendingSubmission = {
      ...submission,
      session_id: id,
      submission_id: submission.submission_id ?? this.id(),
    };
    await this.opts.persistSubmission(pending);
    let attempts = 0;
    while (attempts++ < 3) {
      await this.waitForReady();
      const generation = this.generation;
      let receipt: unknown;
      try {
        receipt = await this.channel.request(
          "prompt.submit",
          pending satisfies CanonicalRpcMethods["prompt.submit"]["params"] as unknown as RecordValue,
        );
      } catch (error) {
        if (!this.desired || error instanceof JsonRpcGatewayError) throw error;
        // A timeout may hide an accepted receipt. Re-send only this exact prepared ID.
        if (attempts >= 3) throw error;
        if (generation === this.generation && this.state === "ready") await delay(250 * attempts);
        continue;
      }
      await this.opts.acknowledgeSubmission(pending, receipt);
      return receipt;
    }
    throw new Error("Submission could not be confirmed");
  }

  async mutate(
    id: string,
    operation: string,
    payload: RecordValue,
    includeGeneration = [
      "delete",
      "rewind",
      "reset",
      "branch",
      "model",
      "compress",
      "reasoning",
      "workspace",
    ].includes(operation),
  ): Promise<RecordValue> {
    id = this.aliases.get(id) ?? id;
    const session = this.sessions.get(id);
    if (!session) throw new Error("Resume the session before mutating");
    const params: CanonicalRpcMethods["session.mutate"]["params"] = {
      session_id: id,
      request_id: this.id(),
      expected_revision: session.revision,
      operation,
      payload,
    };
    if (includeGeneration) params.expected_generation = session.generation;
    const send = async (): Promise<RecordValue> => {
      const result = await this.request<RecordValue>("session.mutate", { ...params });
      if (numeric(result.revision)) session.revision = Math.max(session.revision, result.revision);
      if (numeric(result.execution_generation)) session.generation = result.execution_generation;
      return result;
    };
    try {
      return await send();
    } catch (error) {
      const data = error instanceof JsonRpcGatewayError ? object(error.data) : {};
      if (
        !["revision_conflict", "stale_generation"].includes(String(data.reason)) ||
        !numeric(data.revision) ||
        !numeric(data.execution_generation)
      )
        throw error;
      session.revision = data.revision;
      session.generation = data.execution_generation;
      params.expected_revision = data.revision;
      if (includeGeneration || data.reason === "stale_generation")
        params.expected_generation = data.execution_generation;
      return send();
    }
  }

  private handleServerRequest(request: ServerRequest): boolean {
    if (bridge.test(request.method)) {
      request.fail(4404, "Desktop bridge is not available on this client");
      return true;
    }
    if (request.method !== "sudo" && request.method !== "secret") return false;
    if (!this.opts.requestSecret) {
      request.fail(-32601, "Secure input is not available");
      return true;
    }
    if (this.serverRequests.has(request.id)) return true;
    const controller = new AbortController();
    this.serverRequests.set(request.id, controller);
    const getSecret = this.opts.requestSecret;
    const method = request.method;
    void Promise.resolve()
      .then(() => getSecret(method, request.params, controller.signal))
      .then(
        (value) => {
          if (!controller.signal.aborted) request.respond({ value });
        },
        () => {
          if (!controller.signal.aborted) request.fail(-32603, "Secure input was unavailable");
        },
      )
      .finally(() => {
        if (this.serverRequests.get(request.id) === controller)
          this.serverRequests.delete(request.id);
      });
    return true;
  }
  private abortServerRequests(): void {
    for (const controller of this.serverRequests.values()) controller.abort();
    this.serverRequests.clear();
  }
}
