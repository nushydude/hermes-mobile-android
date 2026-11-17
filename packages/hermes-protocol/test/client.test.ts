import { describe, expect, it } from 'vitest';
import { CanonicalClient, type ClientOptions, type Snapshot, type SocketLike } from '../src/index.js';

type Frame = Record<string, any>;
const sleep = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = (id = 's', revision = 1, sequence = 0) => ({ session_id: id, subscription_id: `sub-${id}`, replay_epoch: 'epoch', last_sequence: sequence, revision, execution_generation: 2, messages: [], running: false, pending: [], prompts: [], info: {} });

class FakeSocket implements SocketLike {
  readyState = 1;
  protocol = 'hermes-gateway-v1';
  listeners = new Map<string, Array<(event: any) => void>>();
  sent: Frame[] = [];
  constructor(readonly server: FakeServer, readonly protocols: string[]) {
    queueMicrotask(() => this.event({ type: 'gateway.ready', payload: { session_authority: server.authority, heartbeat: server.heartbeat, replay_epoch: 'epoch' } }));
  }
  addEventListener(type: 'message' | 'close' | 'error', listener: (event: any) => void): void {
    const existing = this.listeners.get(type) ?? []; existing.push(listener); this.listeners.set(type, existing);
  }
  emit(type: string, value: any): void { for (const fn of this.listeners.get(type) ?? []) fn(value); }
  event(params: Frame): void { this.frame({ jsonrpc: '2.0', method: 'event', params }); }
  frame(frame: Frame): void { if (this.readyState === 1) this.emit('message', { data: JSON.stringify(frame) }); }
  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket closed');
    const frame = JSON.parse(data) as Frame; this.sent.push(frame); this.server.receive(this, frame);
  }
  close(): void { if (this.readyState === 3) return; this.readyState = 3; this.emit('close', { code: 1006 }); }
}
class FakeServer {
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
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer hidden');
    this.tickets++;
    return { ok: true, status: 200, json: async () => ({ ticket: `ticket${this.tickets}` }) } as Response;
  }) as typeof fetch;
  factory = (_url: string, protocols: string[]) => { const socket = new FakeSocket(this, protocols); this.sockets.push(socket); return socket; };
  receive(socket: FakeSocket, frame: Frame): void {
    if (!frame.method) return;
    this.calls.push(frame);
    if (this.custom?.(socket, frame)) return;
    if (frame.method === 'gateway.ping' && !this.respondPings) return;
    const result: Record<string, unknown> = {
      'client.capabilities': { server_requests: [], declines_not_shown: true },
      'runtime.describe': { capabilities: ['event-replay-v1'], session_create: { sources: ['gui'], parameters: ['request_id','source','client','title'] } },
      'session.resume': { ...this.currentSnapshot, session_id: frame.params.session_id },
      'session.events.since': { events: this.replay, snapshot_required: this.snapshotRequired, truncated: false, replay_epoch: 'epoch', last_sequence: 0 },
      'prompt.submit': { status: 'queued', admission_id: 'admission' },
      'session.mutate': { revision: 2 },
      'session.detach': { detached: true },
    };
    const answer = result[frame.method] ?? {};
    queueMicrotask(() => socket.frame({ jsonrpc: '2.0', id: frame.id, result: answer }));
  }
  get socket(): FakeSocket { return this.sockets[this.sockets.length - 1]; }
  event(type: string, payload: Frame, seq: number, session_id = 's'): void {
    this.socket.event({ type, payload, seq, session_id, replay_epoch: 'epoch', execution_generation: 2 });
  }
}
function make(server: FakeServer, extra: Partial<ClientOptions> = {}): CanonicalClient {
  return new CanonicalClient({
    baseUrl: 'https://host.tailnet:9120', getToken: async () => 'hidden', fetch: server.fetch,
    socketFactory: server.factory, persistSubmission: async () => {}, acknowledgeSubmission: async () => {},
    requestTimeoutMs: 40, connectTimeoutMs: 100, heartbeatIntervalMs: 0, heartbeatDeadlineMs: 0,
    backoff: () => 5, ...extra,
  });
}
async function until(predicate: () => boolean, timeout = 500): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for test state'); await sleep(5); }
}

describe('canonical client transport', () => {
  it('offers a ticket for every dial, checks authority and advertises the correct capabilities', async () => {
    const server = new FakeServer(); const client = make(server);
    await client.connect();
    expect(client.connectionState).toBe('ready');
    expect(server.socket.protocols).toEqual(['hermes-gateway-v1', 'hermes-gateway-ticket.ticket1']);
    expect(server.calls.find(c => c.method === 'client.capabilities')?.params).toEqual({ server_requests: true });
    expect(server.calls.find(c => c.method === 'runtime.describe')?.params).toEqual({});
    server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 2);
    expect(server.socket.protocols[1]).toBe('hermes-gateway-ticket.ticket2'); client.close();
    const incompatible = new FakeServer(); incompatible.authority = false;
    const other = make(incompatible); await expect(other.connect()).rejects.toThrow('session authority');
    expect(other.connectionState).toBe('incompatible'); other.close();
    expect(() => make(server, { baseUrl: 'http://not-secure/' })).toThrow('HTTPS');
  });

  it('correlates out-of-order replies and times out a request', async () => {
    const server = new FakeServer(); const pending: Frame[] = [];
    server.custom = (_socket, frame) => { if (frame.method.startsWith('test.')) { pending.push(frame); return true; } return false; };
    const client = make(server); await client.connect();
    const first = client.request('test.first'); const second = client.request('test.second');
    server.socket.frame({ id: pending[1].id, result: 'second' }); server.socket.frame({ id: pending[0].id, result: 'first' });
    expect(await first).toBe('first'); expect(await second).toBe('second');
    await expect(client.request('test.timeout', {}, 15)).rejects.toThrow('timed out'); client.close();
  });

  it('detects a heartbeat death and reconnects with backoff', async () => {
    const server = new FakeServer(); server.respondPings = false;
    const delays: number[] = [];
    const client = make(server, { heartbeatIntervalMs: 10, heartbeatDeadlineMs: 25, backoff: n => { delays.push(n); return 5; } });
    await client.connect(); await until(() => server.tickets >= 2, 500);
    expect(delays[0]).toBe(0); expect(server.calls.some(c => c.method === 'gateway.ping')).toBe(true); client.close();
  });

  it('increases the backoff for consecutive short-lived connections', async () => {
    const server = new FakeServer(); const attempts: number[] = [];
    const client = make(server, { backoff: attempt => { attempts.push(attempt); return 5; } });
    await client.connect(); server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 2);
    server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 3);
    expect(attempts).toEqual([0, 1]); client.close();
  });

  it('times out a stalled ticket fetch without opening a socket', async () => {
    const server = new FakeServer();
    const fetch: typeof globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('ticket timed out')), { once: true });
    });
    const client = make(server, { fetch, connectTimeoutMs: 15, backoff: () => 1000 });
    await expect(client.connect()).rejects.toThrow('timed out');
    expect(server.sockets).toHaveLength(0); client.close();
  });

  it('applies the ticket deadline through response body parsing', async () => {
    const server = new FakeServer(); let signal: AbortSignal | null | undefined;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      signal = init?.signal;
      return { ok: true, status: 200, json: () => new Promise(() => {}) } as unknown as Response;
    };
    const client = make(server, { fetch, connectTimeoutMs: 15, backoff: () => 1000 });
    await expect(client.connect()).rejects.toThrow('timed out');
    expect(signal?.aborted).toBe(true); expect(server.sockets).toHaveLength(0); client.close();
  });
});

describe('sessions and durable events', () => {
  it('refreshes cached authority state and releases the freshly acquired subscription', async () => {
    const server=new FakeServer(); const client=make(server); await client.connect(); await client.openSession('s');
    server.currentSnapshot={...snapshot('s',8,10),subscription_id:'fresh-subscription',prompts:[{prompt_id:'new',choices:['once','deny']}] as any};
    const fresh=await client.refreshSession('s'); expect(fresh.prompts).toEqual([{prompt_id:'new',choices:['once','deny']}]); expect(client.getSession('s')?.revision).toBe(fresh.revision);
    await client.detachSession('s'); expect(server.calls.filter(c=>c.method==='session.detach').at(-1)?.params.subscription_id).toBe('fresh-subscription'); client.close();
  });
  it('shares an in-flight fresh authority request and never returns it after detachment', async () => {
    const server=new FakeServer(); const client=make(server); await client.connect(); await client.openSession('s'); let pending:Frame|undefined;
    server.custom=(_socket,frame)=>{if(frame.method==='session.resume'){pending=frame;return true;}return false;};
    const first=client.refreshSession('s'), second=client.refreshSession('s'); const rejected=Promise.all([expect(first).rejects.toThrow('detached'),expect(second).rejects.toThrow('detached')]);
    await until(()=>!!pending); const leaving=client.detachSession('s'); server.socket.frame({id:pending!.id,result:{...snapshot('s',3,2),subscription_id:'withdrawn'}}); await leaving; await rejected;
    expect(client.getSession('s')).toBeUndefined(); expect(server.calls.filter(c=>c.method==='session.resume')).toHaveLength(2); client.close();
  });
  it.each([
    ['session.events.since', 4001], ['session.resume', 4001],
    ['session.events.since', 4004], ['session.resume', 4004],
  ])('evicts an unavailable session on reconnect %s with code %i and keeps other streams usable', async (method, code) => {
    const server = new FakeServer(); const unavailable: unknown[] = []; const events: Frame[] = [];
    const client = make(server, { onSessionUnavailable: (id, detail) => unavailable.push([id, detail]), onEvent: event => events.push(event) });
    await client.connect(); await client.openSession('bad'); await client.openSession('good');
    server.custom = (socket, frame) => {
      if (frame.method === method && frame.params.session_id === 'bad') {
        queueMicrotask(() => socket.frame({ id: frame.id, error: { code, message: 'private detail', data: { reason: 'not_found', secret: 'private' } } }));
        return true;
      }
      return false;
    };
    server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 2);
    expect(unavailable).toEqual([['bad', { reason: 'not_found', code }]]);
    expect(client.getSession('bad')).toBeUndefined(); expect(client.getSession('good')?.session_id).toBe('good');
    await expect(client.request('session.list', {})).resolves.toBeDefined();
    server.event('message.delta', { turn_id: 't', segment: 0, offset: 0, text: 'live' }, 1, 'good');
    expect(events.some(event => event.session_id === 'good' && event.payload.text === 'live')).toBe(true);
    server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 3);
    expect(unavailable).toHaveLength(1); client.close();
  });

  it.each(['permission', 'malformed'])('does not swallow reconnect %s failures', async failure => {
    const server = new FakeServer(); const unavailable: unknown[] = [];
    const client = make(server, { backoff: () => 1000, onSessionUnavailable: (...args) => unavailable.push(args) });
    await client.connect(); await client.openSession('bad'); await client.openSession('good');
    server.custom = (socket, frame) => {
      if (frame.method === 'session.events.since' && frame.params.session_id === 'bad') {
        queueMicrotask(() => socket.frame(failure === 'permission'
          ? { id: frame.id, error: { code: 4001, message: 'denied', data: { reason: 'permission_denied' } } }
          : { id: frame.id, result: { events: 'invalid' } }));
        return true;
      }
      return false;
    };
    server.socket.close(); await expect(client.reconnectNow()).rejects.toThrow();
    expect(client.connectionState).toBe('reconnecting'); expect(unavailable).toEqual([]);
    await expect(client.request('session.list', {})).rejects.toThrow('not ready'); client.close();
  });

  it('does not notify for a session detached while reconnect replay is pending', async () => {
    const server = new FakeServer(); const unavailable: unknown[] = []; let pending: Frame | undefined;
    const client = make(server, { onSessionUnavailable: (...args) => unavailable.push(args) });
    await client.connect(); await client.openSession('bad'); await client.openSession('good');
    server.custom = (_socket, frame) => {
      if (frame.method === 'session.events.since' && frame.params.session_id === 'bad') { pending = frame; return true; }
      return false;
    };
    server.socket.close(); await until(() => !!pending);
    await client.detachSession('bad');
    server.socket.frame({ id: pending!.id, error: { code: 4004, message: 'not_found', data: { reason: 'not_found' } } });
    await until(() => client.connectionState === 'ready');
    expect(unavailable).toEqual([]); expect(client.getSession('good')?.session_id).toBe('good'); client.close();
  });

  it.each([
    { oldId: 's', owner: 's', reopenId: 's' },
    { oldId: 'stored-tip', owner: 'owner', reopenId: 'owner' },
  ])('waits for cancelled $oldId cleanup before opening $reopenId', async ({ oldId, owner, reopenId }) => {
    const server = new FakeServer(); const events: Frame[] = [];
    let oldResume: Frame | undefined; let pendingDetach: Frame | undefined;
    server.custom = (_socket, frame) => {
      if (frame.method === 'session.resume' && !oldResume) { oldResume = frame; return true; }
      if (frame.method === 'session.detach' && !pendingDetach) { pendingDetach = frame; return true; }
      return false;
    };
    const client = make(server, { onEvent: event => events.push(event), requestTimeoutMs: 200 });
    await client.connect();
    const oldOpen = client.openSession(oldId).catch(error => error);
    await until(() => !!oldResume);
    const oldDetach = client.detachSession(oldId);
    const replacement = client.openSession(reopenId);
    await sleep(5);
    expect(server.calls.filter(frame => frame.method === 'session.resume')).toHaveLength(1);
    server.socket.frame({ id: oldResume!.id, result: snapshot(owner) });
    await until(() => !!pendingDetach);
    await sleep(5);
    expect(server.calls.filter(frame => frame.method === 'session.resume')).toHaveLength(1);
    expect(pendingDetach!.params).toEqual({ session_id: owner, subscription_id: `sub-${owner}` });
    server.socket.frame({ id: pendingDetach!.id, result: { detached: true } });
    await oldDetach;
    expect((await oldOpen).message).toContain('detached');
    expect((await replacement).session_id).toBe(owner);
    expect(client.getSession(reopenId)?.session_id).toBe(owner);
    server.event('message.delta', { turn_id: 'next', segment: 0, offset: 0, text: 'new view' }, 1, owner);
    expect(events.filter(event => event.type === 'message.delta').map(event => event.payload.text)).toEqual(['new view']);
    const methods = server.calls.filter(frame => frame.method === 'session.resume' || frame.method === 'session.detach').map(frame => frame.method);
    expect(methods).toEqual(['session.resume', 'session.detach', 'session.resume']);
    client.close();
  });

  it('detaches every new acquisition when a subscription ID is reused', async () => {
    const server = new FakeServer(); const client = make(server); await client.connect();
    await client.openSession('s'); await client.detachSession('s');
    await client.openSession('s'); await client.detachSession('s');
    const detaches = server.calls.filter(frame => frame.method === 'session.detach');
    expect(detaches.map(frame => frame.params)).toEqual([
      { session_id: 's', subscription_id: 'sub-s' },
      { session_id: 's', subscription_id: 'sub-s' },
    ]);
    client.close();
  });

  it('detaches a pending initial resume without publishing a resolved-owner snapshot', async () => {
    const server = new FakeServer(); let pending: Frame | undefined; const snapshots: Snapshot[] = [];
    const events: Frame[] = [];
    server.custom = (_socket, frame) => {
      if (frame.method === 'session.resume') { pending = frame; return true; }
      return false;
    };
    const client = make(server, { onSnapshot: (_id, value) => snapshots.push(value), onEvent: event => events.push(event) });
    await client.connect();
    const opening = client.openSession('stored-tip');
    const openingOutcome = opening.catch(error => error);
    await until(() => !!pending);
    server.socket.event({ session_id: 'owner', type: 'message.delta', seq: 1, replay_epoch: 'epoch', payload: { text: 'hidden', segment: 0, offset: 0 } });
    const detaching = client.detachSession('stored-tip');
    server.socket.frame({ id: pending!.id, result: snapshot('owner') });
    await detaching;
    expect((await openingOutcome).message).toContain('detached');
    expect(snapshots).toEqual([]);
    expect(events.some(event => event.session_id === 'owner')).toBe(false);
    expect(client.getSession('stored-tip')).toBeUndefined(); expect(client.getSession('owner')).toBeUndefined();
    const detach = server.calls.filter(frame => frame.method === 'session.detach');
    expect(detach).toHaveLength(1); expect(detach[0].params).toEqual({ session_id: 'owner', subscription_id: 'sub-owner' });
    client.close();
  });

  it('detaches a pending reconnect resume and does not reopen that session', async () => {
    const server = new FakeServer(); let pending: Frame | undefined; let snapshots = 0;
    const client = make(server, { onSnapshot: () => { snapshots++; } }); await client.connect(); await client.openSession('s');
    server.custom = (_socket, frame) => {
      if (server.tickets === 2 && frame.method === 'session.resume') { pending = frame; return true; }
      return false;
    };
    server.socket.close(); await until(() => !!pending);
    const detaching = client.detachSession('s');
    server.socket.frame({ id: pending!.id, result: snapshot('s', 2, 0) });
    await detaching; await until(() => client.connectionState === 'ready');
    expect(snapshots).toBe(1); expect(client.getSession('s')).toBeUndefined();
    const detach = server.calls.filter(frame => frame.method === 'session.detach');
    expect(detach).toHaveLength(1); expect(detach[0].params).toEqual({ session_id: 's', subscription_id: 'sub-s' });
    client.close();
  });

  it('does not resume a session detached while its reconnect replay is pending', async () => {
    const server = new FakeServer(); let pending: Frame | undefined;
    const client = make(server); await client.connect(); await client.openSession('s');
    server.custom = (_socket, frame) => {
      if (server.tickets === 2 && frame.method === 'session.events.since') { pending = frame; return true; }
      return false;
    };
    server.socket.close(); await until(() => !!pending);
    await client.detachSession('s');
    server.socket.frame({ id: pending!.id, result: { events: [], snapshot_required: false, truncated: false, replay_epoch: 'epoch', last_sequence: 0 } });
    await until(() => client.connectionState === 'ready');
    expect(server.calls.filter(frame => frame.method === 'session.resume')).toHaveLength(1);
    expect(client.getSession('s')).toBeUndefined(); client.close();
  });

  it('routes an older compressed session to the owner returned by resume', async () => {
    const server = new FakeServer(); const events: Frame[] = [];
    const active = { ...snapshot('owner', 2, 1), running: true };
    const delta = { session_id: 'owner', type: 'message.delta', seq: 1, execution_generation: 2, replay_epoch: 'epoch', payload: { turn_id: 'turn', segment: 0, offset: 0, text: 'live' } };
    server.replay = [delta];
    server.custom = (socket, frame) => {
      if (frame.method !== 'session.resume' || frame.params.session_id !== 'stored-tip') return false;
      socket.event(delta); queueMicrotask(() => socket.frame({ id: frame.id, result: active })); return true;
    };
    const client = make(server, { onEvent: event => events.push(event) }); await client.connect();
    expect((await client.openSession('stored-tip')).session_id).toBe('owner');
    expect(client.getSession('stored-tip')?.session_id).toBe('owner');
    expect(events.filter(e => e.type === 'message.delta').map(e => e.payload.text)).toEqual(['live']);
    await client.submit({ session_id: 'stored-tip', text: 'continue' });
    expect(server.calls.find(c => c.method === 'prompt.submit')?.params.session_id).toBe('owner');
    await client.detachSession('stored-tip');
    expect(server.calls.find(c => c.method === 'session.detach')?.params.session_id).toBe('owner'); client.close();
  });

  it('recovers the active partial reply when first joining an already-running session', async () => {
    const server = new FakeServer(); const events: Frame[] = []; const order: string[] = [];
    server.currentSnapshot = { ...snapshot('s', 2, 4), running: true };
    server.replay = [
      { session_id: 's', type: 'message.delta', seq: 1, execution_generation: 1, replay_epoch: 'epoch', payload: { turn_id: 'old', segment: 0, offset: 0, text: 'old turn' } },
      { session_id: 's', type: 'message.delta', seq: 4, execution_generation: 2, replay_epoch: 'epoch', payload: { turn_id: 'current', segment: 0, offset: 0, text: 'partial' } },
    ];
    const client = make(server, { onEvent: event => { events.push(event); order.push(event.type); }, onSnapshot: () => order.push('snapshot') });
    await client.connect(); await client.openSession('s');
    expect(events.filter(e => e.type === 'message.delta').map(e => e.payload.text)).toEqual(['partial']);
    expect(order.indexOf('snapshot')).toBeLessThan(order.indexOf('message.delta'));
    expect(server.calls.find(c => c.method === 'session.events.since')?.params).toEqual({ session_id: 's', last_sequence: 0, replay_epoch: 'epoch' });
    client.close();
  });

  it('replays each open session before resume and drops overlapping deltas by offset', async () => {
    const server = new FakeServer(); const events: Frame[] = [];
    const client = make(server, { onEvent: event => events.push(event) }); await client.connect(); await client.openSession('s');
    server.event('message.delta', { turn_id: 'turn', segment: 0, offset: 0, text: 'hi' }, 1);
    server.replay = [
      { session_id: 's', type: 'message.delta', seq: 2, replay_epoch: 'epoch', payload: { turn_id: 'turn', segment: 0, offset: 0, text: 'hi!' } },
    ];
    server.currentSnapshot = snapshot('s', 2, 2); server.socket.close();
    await until(() => client.connectionState === 'ready' && server.tickets === 2);
    const lastReplay = server.calls.map(c => c.method).lastIndexOf('session.events.since');
    expect(lastReplay).toBeLessThan(server.calls.map(c => c.method).lastIndexOf('session.resume'));
    expect(server.calls[lastReplay]?.params).toEqual({ session_id: 's', last_sequence: 1, replay_epoch: 'epoch' });
    expect(events.filter(e => e.type === 'message.delta').map(e => e.payload.text)).toEqual(['hi', '!']); client.close();
  });

  it('delivers the catch-up events the authority emits before the resume response', async () => {
    const server = new FakeServer(); const events: Frame[] = [];
    const client = make(server, { onEvent: event => events.push(event) }); await client.connect(); await client.openSession('s');
    server.event('message.delta', { turn_id: 'turn', segment: 0, offset: 0, text: 'a' }, 1);
    server.replay = [{ session_id: 's', type: 'message.delta', seq: 2, replay_epoch: 'epoch', payload: { turn_id: 'turn', segment: 0, offset: 1, text: 'b' } }];
    server.currentSnapshot = snapshot('s', 2, 3);
    server.custom = (socket, frame) => {
      if (frame.method !== 'session.resume' || server.tickets !== 2) return false;
      socket.event({ session_id: 's', type: 'message.delta', seq: 3, replay_epoch: 'epoch', payload: { turn_id: 'turn', segment: 0, offset: 2, text: 'c' } });
      queueMicrotask(() => socket.frame({ id: frame.id, result: server.currentSnapshot })); return true;
    };
    server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 2);
    expect(events.filter(e => e.type === 'message.delta').map(e => e.payload.text)).toEqual(['a', 'b', 'c']); client.close();
  });

  it('keeps separate per-session cursors when multiple sessions reconnect', async () => {
    const server = new FakeServer(); const client = make(server); await client.connect();
    await client.openSession('s'); await client.openSession('t');
    server.event('session.info', { revision: 2 }, 3, 's'); server.event('session.info', { revision: 2 }, 7, 't');
    server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 2);
    const requests = server.calls.filter(c => c.method === 'session.events.since');
    expect(requests.map(c => [c.params.session_id, c.params.last_sequence])).toEqual([['s', 3], ['t', 7]]); client.close();
  });

  it('rebuilds on snapshot_required and replay_gap', async () => {
    const server = new FakeServer(); const reasons: string[] = [];
    const client = make(server, { onSnapshot: (_id, _snapshot, reason) => reasons.push(reason) });
    await client.connect(); await client.openSession('s'); server.snapshotRequired = true;
    server.currentSnapshot = snapshot('s', 3, 9); server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 2);
    expect(reasons).toEqual(['resume', 'rebuild']);
    server.event('session.replay_gap', { latest_seq: 11 }, 10);
    await until(() => reasons.length === 3);
    expect(reasons[2]).toBe('rebuild'); client.close();
  });

  it.each(['snapshot_required', 'replay_gap'] as const)('continues a running turn with an unknown prefix after %s', async reason => {
    const server = new FakeServer(); const deltas: Frame[] = []; const partial: Frame[] = []; const snapshots: string[] = [];
    const client = make(server, { onEvent: event => { if (event.type === 'message.delta') deltas.push(event); },
      onPartialUnavailable: (id, info) => partial.push({ id, ...info }), onSnapshot: (_id, _snapshot, why) => snapshots.push(why) });
    await client.connect(); await client.openSession('s');
    server.currentSnapshot = { ...snapshot('s', 3, 9), running: true };
    if (reason === 'snapshot_required') {
      server.snapshotRequired = true; server.socket.close();
      await until(() => client.connectionState === 'ready' && server.tickets === 2);
    } else {
      server.event('session.replay_gap', { latest_seq: 9 }, 9);
      await until(() => snapshots.includes('rebuild'));
    }
    server.event('message.delta', { turn_id: 'turn', segment: 0, offset: 20, text: 'tail' }, 10);
    server.event('message.delta', { turn_id: 'turn', segment: 0, offset: 22, text: 'il!' }, 11);
    await sleep(10);
    expect(snapshots.filter(why => why === 'rebuild')).toHaveLength(1);
    expect(partial).toEqual([{ id: 's', turn: 'turn', segment: 0, offset: 20 }]);
    expect(deltas.map(event => [event.payload.offset, event.payload.text])).toEqual([[20, 'tail'], [24, '!']]);
    expect(server.calls.filter(frame => frame.method === 'session.resume')).toHaveLength(2);
    client.close();
  });

  it('waits for a replay gap received during reconnect to rebuild before becoming ready', async () => {
    const server = new FakeServer(); let rebuildSeen = false; let resumeCount = 0;
    const client = make(server, { onSnapshot: (_id, _snapshot, reason) => { if (reason === 'rebuild') rebuildSeen = true; } });
    await client.connect(); await client.openSession('s');
    server.custom = (socket, frame) => {
      if (frame.method !== 'session.resume' || server.tickets !== 2) return false;
      resumeCount++;
      if (resumeCount === 1) socket.event({ session_id: 's', type: 'session.replay_gap', payload: {}, seq: 1, replay_epoch: 'epoch' });
      queueMicrotask(() => socket.frame({ id: frame.id, result: server.currentSnapshot })); return true;
    };
    server.socket.close(); await until(() => client.connectionState === 'ready' && server.tickets === 2);
    expect(rebuildSeen).toBe(true); expect(resumeCount).toBe(2); client.close();
  });

  it('persists before sending, retries lost reply with the same submission ID and acknowledges once', async () => {
    const server = new FakeServer(); const operations: string[] = []; const ids: string[] = [];
    server.custom = (socket, frame) => {
      if (frame.method !== 'prompt.submit') return false;
      operations.push('send'); ids.push(frame.params.submission_id);
      if (ids.length === 1) socket.close(); else queueMicrotask(() => socket.frame({ id: frame.id, result: { status: 'started' } }));
      return true;
    };
    const client = make(server, { createId: () => 'stable-id', persistSubmission: async () => { operations.push('persist'); }, acknowledgeSubmission: async () => { operations.push('ack'); } });
    await client.connect(); await client.openSession('s');
    await client.submit({ session_id: 's', text: 'hello' });
    expect(ids).toEqual(['stable-id', 'stable-id']); expect(operations).toEqual(['persist', 'send', 'send', 'ack']); client.close();
  });

  it('retries a fenced mutation once using the conflict revision and generation', async () => {
    const server = new FakeServer(); const calls: Frame[] = [];
    server.custom = (socket, frame) => {
      if (frame.method !== 'session.mutate') return false;
      calls.push(frame); queueMicrotask(() => socket.frame(calls.length === 1
        ? { id: frame.id, error: { code: 4001, message: 'revision_conflict', data: { reason: 'revision_conflict', revision: 5, execution_generation: 3 } } }
        : { id: frame.id, result: { revision: calls.length + 4 } })); return true;
    };
    const client = make(server, { createId: () => 'mutation-id' }); await client.connect(); await client.openSession('s');
    await client.mutate('s', 'rename', { title: 'x' });
    await client.mutate('s', 'archive', { archived: true });
    expect(calls.map(c => c.params.expected_revision)).toEqual([1, 5, 6]); expect(calls[1].params.request_id).toBe('mutation-id');
    client.close();
  });

  it('refreshes the generation fence on a stale_generation response and retries only once', async () => {
    const server = new FakeServer(); const calls: Frame[] = [];
    server.custom = (socket, frame) => {
      if (frame.method !== 'session.mutate') return false;
      calls.push(frame); queueMicrotask(() => socket.frame({ id: frame.id, error: { code: 4001, message: 'stale_generation', data: { reason: 'stale_generation', revision: 4, execution_generation: 8 } } })); return true;
    };
    const client = make(server); await client.connect(); await client.openSession('s');
    await expect(client.mutate('s', 'model', { model: 'model' }, true)).rejects.toThrow('stale_generation');
    expect(calls).toHaveLength(2); expect(calls[1].params.expected_revision).toBe(4); expect(calls[1].params.expected_generation).toBe(8); client.close();
  });
});

describe('server requests', () => {
  it('answers secure input, declines bridges, rejects unknown requests, and aborts withdrawn input', async () => {
    const server = new FakeServer(); let cancelSignal: AbortSignal | undefined;
    const client = make(server, { requestSecret: async (method, _params, signal) => {
      if (method === 'sudo') return 'secure-value';
      cancelSignal = signal; return new Promise(() => {});
    } });
    await client.connect();
    server.socket.frame({ jsonrpc: '2.0', id: 'r1', method: 'sudo', params: { session_id: 's' } });
    server.socket.frame({ jsonrpc: '2.0', id: 'r2', method: 'preview.open', params: {} });
    server.socket.frame({ jsonrpc: '2.0', id: 'r3', method: 'unknown', params: {} });
    server.socket.frame({ jsonrpc: '2.0', id: 'r4', method: 'secret', params: {} });
    server.socket.event({ type: 'request.cancel', payload: { id: 'r4' } });
    await until(() => server.socket.sent.some(frame => frame.id === 'r1' && frame.result));
    expect(server.socket.sent.find(f => f.id === 'r1' && f.result)?.result).toEqual({ value: 'secure-value' });
    expect(server.socket.sent.find(f => f.id === 'r2' && f.error)?.error.code).toBe(4404);
    expect(server.socket.sent.find(f => f.id === 'r3' && f.error)?.error.code).toBe(-32601);
    expect(cancelSignal?.aborted).toBe(true); expect(server.socket.sent.some(f => f.id === 'r4' && (f.error || f.result))).toBe(false); client.close();
  });
});
