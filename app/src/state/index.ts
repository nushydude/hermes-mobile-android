import { useCallback, useRef, useSyncExternalStore } from 'react';
import { AppState as NativeAppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { CanonicalClient, JsonRpcGatewayError, randomUUID, type GatewayEvent, type PendingSubmission } from '@hermes-mobile/protocol';
import type { AppState, ChatState, QueuedEdit, SessionRow } from '../types';
import { compactActivity, emptyChat, mergeSessions, reduceEvent, snapshotChat } from './reducer';
import { ImageReads } from './imageReads';
import { notifyEvent, reconcileSnapshot } from '../notifications';
import { limitedText } from './voiceHttp';
import { conversationDiagnostics } from './conversationDiagnostics';
import { validAction } from '../notificationCore';
import { buildVersion } from '../buildVersion';

const BASE = 'hermes.baseUrl', TOKEN = 'hermes.token', CONFIG = 'hermes.config.v1';
type Credentials = {version: 1; origin: string; token: string};
const cacheKey = (origin: string) => `state:${origin}`;
const initial = (): AppState => ({ historyTruncated: false, credentialsConfigured: false, connection: 'offline', error: null, sessions: [], activeSessionId: null, chats: {}, drafts: {}, outbox: [], queuedEdits: [], secureRequest: null });
const mergeDraftImages=(a:ChatState['draftAttachments']=[],b:ChatState['draftAttachments']=[])=>[...new Map([...a,...b].map(image=>[image.path,image])).values()];
const asObject = (v: unknown): Record<string, any> => v && typeof v === 'object' ? v as Record<string, any> : {};
function restorePosition<T extends {submission_id: string; enqueue_order: number}>(current: T[], item: T): T[] {
  if (current.some(x => x.submission_id === item.submission_id)) return current;
  return [...current, item].sort((a,b) => a.enqueue_order - b.enqueue_order);
}
const id = randomUUID;

export class AppManager {
  private diagnosticSubmissions = new Map<string, {trace:number;sessionId:string}>();
  private state = initial();
  private listeners = new Set<() => void>();
  private voiceListeners = new Set<(event:GatewayEvent)=>void>();
  subscribeVoiceEvents = (listener:(event:GatewayEvent)=>void) => {this.voiceListeners.add(listener);return () => {this.voiceListeners.delete(listener);};};
  private client: CanonicalClient | null = null;
  private baseUrl = '';
  private credentials: Credentials | null = null;
  private endpointEpoch = 0;
  private configuring = false;
  private commitSource: string | null = null;
  private commitTarget: string | null = null;
  private commitTargetPayload: any = null;
  private pendingCaches = new Map<string, {key:string; data:string}>();
  private disposed = false;
  getEndpointEpoch = () => this.endpointEpoch;
  getConfiguredOrigin = () => this.baseUrl;
  assertEndpointEpoch = (epoch: number) => { if (epoch !== this.endpointEpoch || this.disposed) throw new Error('Gateway changed'); };
  private db: SQLite.SQLiteDatabase | null = null;
  private writes: Promise<void> = Promise.resolve();
  private mutations: Promise<void> = Promise.resolve();
  private nextOrdinal = 1;
  private draftRevision = 0;
  private imageReads = new ImageReads();
  private queueMutation<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutations.catch(() => {}).then(work);
    this.mutations = result.then(() => {}, () => {});
    return result;
  }
  private queueForEndpoint<T>(work: () => Promise<T>) { const epoch = this.endpointEpoch; return this.queueMutation(() => { this.assertEndpointEpoch(epoch); return work(); }); }
  private initPromise: Promise<void> | null = null;
  private operationVersions = new Map<string, number>();
  private draftVersions = new Map<string, number>();
  private transcriptVersions = new Map<string, number>();
  private inventoryFlight: {client: CanonicalClient; epoch: number; again: boolean; promise: Promise<void>} | null = null;
  private version(key: string) { const value = (this.operationVersions.get(key) ?? 0) + 1; this.operationVersions.set(key, value); return value; }
  private draining = false;
  private drainEpoch = -1;
  private drainRequested = false;
  private recent: string[] = [];
  private events: GatewayEvent[] = [];
  private snapshotCutoffs = new Map<string, { epoch: string; sequence: number; running: boolean }>();
  private eventTimer: ReturnType<typeof setTimeout> | null = null;
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: Array<() => void> = [];
  private secret: { request: NonNullable<AppState['secureRequest']>; resolve: (v: string) => void; reject: (e: Error) => void } | null = null;
  private warningVersions = new Map<string, number>();
  private storageWarning: {kind:string; message:string; revision:number; epoch:number} | null = null;
  private clearCoveredWarning(coverage: 'draft' | 'full', revision: number, epoch: number) {
    const warning = this.storageWarning;
    if (!warning || warning.epoch !== epoch || this.endpointEpoch !== epoch ||
        warning.revision > revision || this.draftRevision > revision ||
        (coverage === 'draft' && warning.kind !== 'draft') || this.state.error !== warning.message) return;
    this.storageWarning = null;
    this.update({error:null});
  }
  private checkpointWarning(kind: string, write: Promise<void>, message: string) {
    const epoch = this.endpointEpoch;
    const revision = this.draftRevision;
    const version = (this.warningVersions.get(kind) ?? 0) + 1;
    this.warningVersions.set(kind, version);
    return write.catch(error => {
      if (this.endpointEpoch === epoch && this.warningVersions.get(kind) === version) {
        this.storageWarning = {kind, message, revision, epoch};
        this.update({error:message});
      }
      throw error;
    });
  }
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<AppState>) { if ('error' in patch && patch.error !== this.storageWarning?.message) this.storageWarning = null; this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private persist(): Promise<void> {
    const key = this.baseUrl ? cacheKey(this.baseUrl) : 'state'; const payload = { sessions: this.state.sessions, chats:this.state.chats, drafts: this.state.drafts, draftRevision:++this.draftRevision, outbox: this.state.outbox, historyTruncated: this.state.historyTruncated, nextOrdinal: this.nextOrdinal, queuedEdits: this.state.queuedEdits, recent: this.recent }; const data = JSON.stringify(this.baseUrl ? {version:1, origin:this.baseUrl, payload} : payload);
    const epoch = this.endpointEpoch, revision = payload.draftRevision;
    if (this.commitSource !== null && this.baseUrl === this.commitSource) {
      const stash = this.commitSource === '' && this.commitTarget ? {key:cacheKey(this.commitTarget), data:JSON.stringify({version:1, origin:this.commitTarget, payload:this.commitTargetPayload ? this.mergeUnbound(this.commitTargetPayload, payload) : payload})} : {key, data};
      this.pendingCaches.set(stash.key, stash);
    }
    if (this.pendingCaches.has(key)) this.pendingCaches.set(key, {key, data});
    const write = this.writes.catch(() => {}).then(async () => {
      if (!this.db) throw new Error('Local storage is unavailable');
      const pending = this.pendingCaches.get(key);
      await this.db.runAsync('INSERT OR REPLACE INTO app_cache (key, value) VALUES (?, ?)', key, data);
      if (pending && pending.data === data && this.pendingCaches.get(key) === pending) this.pendingCaches.delete(key);
      this.clearCoveredWarning('full', revision, epoch);
    });
    this.writes = write; return write;
  }
  // Draft checkpoints avoid serializing transcripts on each keypress. A full durable
  // cache checkpoint has a newer revision, so a send/clear cannot revive an old draft.
  private persistDrafts(): Promise<void> {
    if (this.commitSource !== null) return this.persist();
    const origin = this.baseUrl;
    const revision = ++this.draftRevision, epoch = this.endpointEpoch;
    const data = JSON.stringify({version:1, origin, revision, drafts:this.state.drafts});
    const write = this.writes.catch(() => {}).then(async () => {
      if (!this.db) throw new Error('Local storage is unavailable');
      await this.db.runAsync('INSERT OR REPLACE INTO app_cache (key, value) VALUES (?, ?)', `drafts:${origin}`, data);
      this.clearCoveredWarning('draft', revision, epoch);
    });
    this.writes = write; return write;
  }
  private async withDraftCheckpoint(payload: any, origin: string) {
    const row = await this.db!.getFirstAsync<{value:string}>('SELECT value FROM app_cache WHERE key = ?', `drafts:${origin}`);
    if (row) {
      try {
        const saved = JSON.parse(row.value);
        if (saved.version === 1 && saved.origin === origin && Number.isSafeInteger(saved.revision) && saved.revision > (payload.draftRevision ?? 0) && saved.drafts && typeof saved.drafts === 'object' && !Array.isArray(saved.drafts) && Object.values(saved.drafts).every(value => typeof value === 'string')) payload = {...payload, drafts:saved.drafts, draftRevision:saved.revision};
      } catch { this.update({error:'A saved draft checkpoint could not be read.'}); }
    }
    this.draftRevision = Math.max(this.draftRevision, Number(payload.draftRevision) || 0);
    return payload;
  }
  private scheduleCache() { if (!this.cacheTimer) this.cacheTimer = setTimeout(() => { this.cacheTimer = null; void this.checkpointWarning('cache', this.persist(), 'Could not save local cache.').catch(() => {}); }, 500); }
  initialize = (): Promise<void> => {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init(); return this.initPromise;
  };
  private async init() {
    this.db = await SQLite.openDatabaseAsync('hermes-mobile.db');
    await this.db.execAsync('CREATE TABLE IF NOT EXISTS app_cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
    const raw = await SecureStore.getItemAsync(CONFIG); let credentials: Credentials | null = null; let legacy = false; let invalidConfig = false;
    if (raw !== null) {
      try { const parsed = JSON.parse(raw); const url = new URL(parsed.origin); if (parsed.version !== 1 || typeof parsed.token !== 'string' || !parsed.token || url.protocol !== 'https:' || url.origin !== parsed.origin || url.username || url.password) throw new Error(); credentials = parsed; } catch { invalidConfig = true; this.update({error:'Stored gateway credentials are invalid. Configure the gateway again.'}); }
    } else {
      const [base, token] = await Promise.all([SecureStore.getItemAsync(BASE), SecureStore.getItemAsync(TOKEN)]);
      if (base && token) { try { const url = new URL(base); if (url.protocol === 'https:' && url.origin === base && !url.username && !url.password) { credentials = {version:1, origin:base, token}; legacy = true; } } catch {} }
    }
    this.credentials = credentials; this.baseUrl = credentials?.origin ?? '';
    let row = invalidConfig ? null : await this.db.getFirstAsync<{ value: string }>('SELECT value FROM app_cache WHERE key = ?', credentials ? cacheKey(credentials.origin) : 'state');
    if (!row && legacy) row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM app_cache WHERE key = ?', 'state');
    if (!invalidConfig) { try {
      let c: any = {};
      if (row) {
      const parsed = JSON.parse(row.value); c = parsed.version === 1 && parsed.payload ? (parsed.origin === credentials?.origin ? parsed.payload : {}) : (legacy || !credentials ? parsed : {});
      }
      this.restoreCache(await this.withDraftCheckpoint(c, credentials?.origin ?? ''));
    } catch { this.update({ error: 'Local cache could not be read.' }); } }
    if (row && !credentials) await this.persist();
    if (legacy && credentials) { await this.persist(); await SecureStore.setItemAsync(CONFIG, JSON.stringify(credentials)); await SecureStore.deleteItemAsync(BASE); await SecureStore.deleteItemAsync(TOKEN); }
    const appListener = NativeAppState.addEventListener('change', state => { if (state === 'active') void this.client?.reconnectNow().catch(() => {}); });
    if (appListener?.remove) this.cleanup.push(() => appListener.remove());
    const unsubscribe = NetInfo.addEventListener(state => { if (state.isConnected) void this.client?.reconnectNow().catch(() => {}); });
    if (unsubscribe) this.cleanup.push(unsubscribe);
    if (credentials) { this.update({ credentialsConfigured: true }); this.startClient(credentials); void this.client!.connect().catch(() => {}); }
  }
  private restoreCache(c: any) {
    this.draftRevision = Math.max(this.draftRevision, Number(c.draftRevision) || 0);
    this.recent = Array.isArray(c.recent) ? c.recent.slice(0,8) : [];
    const all = [...(c.outbox ?? []), ...(c.queuedEdits ?? [])];
    let next = Math.max(1, Number(c.nextOrdinal) || 1, ...all.map((x: any) => Number.isSafeInteger(x.enqueue_order) ? x.enqueue_order + 1 : 1));
    for (const item of all) if (!Number.isSafeInteger(item.enqueue_order)) item.enqueue_order = next++;
    this.nextOrdinal = next; const ranks = new Map(all.map((x: any) => [x.submission_id, x.enqueue_order]));
    for (const chat of Object.values(c.chats ?? {}) as any[]) for (const message of chat.localMessages ?? []) if (!Number.isSafeInteger(message.enqueue_order)) message.enqueue_order = ranks.get(message.submission_id) ?? this.nextOrdinal++;
    const chats = Object.fromEntries(Object.entries(c.chats ?? {}).map(([id,value]) => {const chat = value as ChatState; return [id,{...chat,blocks:compactActivity(chat.blocks ?? [])}];}));
    this.update({sessions:(c.sessions ?? []).map((row:SessionRow) => ({...row,needs_attention:chats[row.id] ? !!chats[row.id].prompts?.length : !!row.needs_attention,session_unavailable:!!chats[row.id]?.sessionUnavailable})), chats, drafts:c.drafts ?? {}, outbox:c.outbox ?? [], queuedEdits:c.queuedEdits ?? [], historyTruncated:!!c.historyTruncated, activeSessionId:null});
    this.trimIdleChats();
  }
  private trimIdleChats() {
    const keep = new Set(this.recent);
    // Old caches may not have recent membership; keep up to eight useful snapshots.
    for (const id of Object.keys(this.state.chats).reverse()) { if (keep.size >= 8) break; keep.add(id); }
    const chats = {...this.state.chats}; let changed = false;
    for (const [id,chat] of Object.entries(chats)) {
      if (keep.has(id) || id === this.state.activeSessionId || chat.running || chat.prompts.length || chat.pending.length || chat.sessionUnavailable) continue;
      const local = (this.state.drafts[id] ?? '').length || chat.draftAttachments?.length || chat.importedShareIds?.length || chat.localMessages.length || chat.draftAlternatives?.length || this.state.outbox.some(x => x.session_id === id) || this.state.queuedEdits.some(x => x.session_id === id);
      if (local) {
        if (!chat.snapshot && !chat.messages.length && !chat.blocks.length && !chat.liveText) continue;
        chats[id] = {...chat,snapshot:null,messages:[],blocks:[],liveText:'',cursor:null,usage:null,partialUnavailable:false};
      } else delete chats[id];
      // In-flight pagination/completion refreshes must not refill an evicted chat.
      this.transcriptVersions.set(id,(this.transcriptVersions.get(id) ?? 0) + 1);
      changed = true;
    }
    if (changed) this.update({chats});
  }
  private mergeUnbound(scoped: any, unbound: any) {
    const conflict = () => { throw new Error('Local drafts or queued messages conflict with the saved gateway cache. They have been preserved; resolve the local work before reconnecting.'); };
    if (!scoped || typeof scoped !== 'object' || !unbound || typeof unbound !== 'object') return conflict();
    const drafts = {...(scoped.drafts ?? {})}; const draftConflicts = new Map<string,string>();
    for (const [id, value] of Object.entries(unbound.drafts ?? {})) { if (drafts[id] && value && drafts[id] !== value) { let alternate = ((scoped.chats ?? {})[id]?.draftAlternatives ?? []).find((key:string) => key.replace(/^_*/, '').startsWith('unbound:') && drafts[key] === value); if (!alternate) { alternate = `unbound:${id}`; while (alternate in drafts || alternate in (unbound.drafts ?? {})) alternate = `_${alternate}`; drafts[alternate] = value; } draftConflicts.set(id, alternate); } else if (value || !(id in drafts)) drafts[id] = value; }
    const scopedQueue = [...(scoped.outbox ?? []), ...(scoped.queuedEdits ?? [])];
    const incomingQueue = [...(unbound.outbox ?? []), ...(unbound.queuedEdits ?? [])];
    const scopedChats = scoped.chats ?? {}; const unboundChats = unbound.chats ?? {};
    const scopedLocals = new Map<string,any>(); for (const chat of Object.values(scopedChats) as any[]) for (const item of chat.localMessages ?? []) scopedLocals.set(item.submission_id, item);
    const stable = (value:any):any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => key !== 'enqueue_order').sort().map(key => [key,stable(value[key])])) : value;
    const same = (a:any,b:any) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
    const duplicateQueue = new Set<string>();
    for (const item of incomingQueue) { const existing = scopedQueue.find((x:any) => x.submission_id === item.submission_id); if (existing) { if (!same(existing,item)) conflict(); duplicateQueue.add(item.submission_id); } else if (scopedLocals.has(item.submission_id)) conflict(); }
    const duplicateLocals = new Set<string>();
    for (const chat of Object.values(unboundChats) as any[]) for (const item of chat.localMessages ?? []) { const existing = scopedLocals.get(item.submission_id); if (existing) { if (!same(existing,item)) conflict(); duplicateLocals.add(item.submission_id); } }
    let next = Math.max(1, Number(scoped.nextOrdinal) || 1, ...scopedQueue.map((x:any) => (Number(x.enqueue_order) || 0) + 1), ...(Object.values(scopedChats) as any[]).flatMap(chat => (chat.localMessages ?? []).map((x:any) => (Number(x.enqueue_order) || 0) + 1)));
    const ordered = new Map<string,number>();
    const incoming = [...incomingQueue, ...(Object.values(unboundChats) as any[]).flatMap(chat => chat.localMessages ?? [])].sort((a:any,b:any) => (a.enqueue_order ?? 0) - (b.enqueue_order ?? 0));
    for (const item of incoming) if (!ordered.has(item.submission_id)) { const existing = scopedQueue.find((x:any) => x.submission_id === item.submission_id) ?? scopedLocals.get(item.submission_id); ordered.set(item.submission_id, existing?.enqueue_order ?? next++); }
    const remap = (item:any) => ({...item, enqueue_order:ordered.get(item.submission_id)});
    const chats = {...scopedChats};
    const historyKeys = ['snapshot','messages','blocks','prompts','pending','liveText','running','usage','cursor','partialUnavailable','sessionUnavailable'] as const;
    const defaults: Record<string,unknown> = {...emptyChat(), sessionUnavailable:false};
    const history = (chat:any) => Object.fromEntries(historyKeys.map(key => [key, chat[key] === undefined ? defaults[key] : chat[key]]));
    const canonical = (value:any):any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
    const sameHistory = (a:any,b:any) => JSON.stringify(canonical(history(a))) === JSON.stringify(canonical(history(b)));
    for (const [id, value] of Object.entries(unboundChats)) {
      const source:any = value, target:any = chats[id];
      if (target && !sameHistory(source, {}) && !sameHistory(source, target)) conflict();
      chats[id] = {...(target ?? source), localMessages:[...(target?.localMessages ?? []), ...(source.localMessages ?? []).filter((x:any) => !duplicateLocals.has(x.submission_id)).map(remap)], draftAlternatives:[...new Set([...(target?.draftAlternatives ?? []), ...(source.draftAlternatives ?? [])])],draftAttachments:mergeDraftImages(source.draftAttachments,target?.draftAttachments),importedShareIds:[...new Set<string>([...(source.importedShareIds ?? []),...(target?.importedShareIds ?? [])])].slice(-100)};
    }
    for (const [id, alternate] of draftConflicts) { const chat = chats[id] ?? emptyChat(); chats[id] = {...chat, draftAlternatives:[...new Set([...(chat.draftAlternatives ?? []), alternate])]}; }
    const sessions = [...(scoped.sessions ?? [])]; for (const row of unbound.sessions ?? []) if (!sessions.some((x:any) => x.id === row.id)) sessions.push(row);
    return {...scoped, sessions, chats, drafts, outbox:[...(scoped.outbox ?? []), ...(unbound.outbox ?? []).filter((x:any) => !duplicateQueue.has(x.submission_id)).map(remap)], queuedEdits:[...(scoped.queuedEdits ?? []), ...(unbound.queuedEdits ?? []).filter((x:any) => !duplicateQueue.has(x.submission_id)).map(remap)], nextOrdinal:next, recent:[...new Set([...(scoped.recent ?? []), ...(unbound.recent ?? [])])].slice(0,8), historyTruncated:!!scoped.historyTruncated || !!unbound.historyTruncated, draftRevision:Math.max(Number(scoped.draftRevision)||0,Number(unbound.draftRevision)||0)};
  }
  private hasUnreconciled() { return Object.values(this.state.drafts).some(x => x.length > 0) || this.state.outbox.length > 0 || this.state.queuedEdits.length > 0 || Object.values(this.state.chats).some(chat => !!chat.draftAttachments?.length || (chat.localMessages ?? []).some(message => message.status !== 'completed')); }
  configure = async ({ baseUrl, token }: { baseUrl: string; token: string }) => {
    if (this.configuring) throw new Error('Connection setup is already in progress.');
    this.configuring = true; let candidate: CanonicalClient | null = null;
    try {
      await this.initialize(); if (this.disposed) throw new Error('Manager disposed');
      const url = new URL(baseUrl.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !token) throw new Error('Enter an HTTPS gateway URL without credentials, query or fragment.');
      const origin = url.origin; const credentials: Credentials = {version:1, origin, token};
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
      let response: Response; try { response = await fetch(`${origin}/api/auth/me`, { headers:{Authorization:`Bearer ${token}`}, signal:controller.signal, redirect:'error' }); } catch { throw new Error('Could not reach the gateway. Check Tailscale and the PC.'); } finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error(response.status === 401 ? 'The gateway rejected this token.' : 'Could not verify the gateway connection.');
      const staged = this.makeClient(credentials); candidate = staged.client; await candidate.connect();
      await this.queueMutation(async () => {
        if (this.disposed) throw new Error('Manager disposed');
        await this.writes.catch(() => {});
        const changing = !!this.baseUrl && this.baseUrl !== origin;
        if (changing && this.hasUnreconciled()) throw new Error('Resolve drafts and pending messages before changing gateways.');
        if (changing) await this.persist();
        let target: any = {}; const binding = !this.baseUrl;
        if (changing || binding) { const row = this.pendingCaches.get(cacheKey(origin)) ? {value:this.pendingCaches.get(cacheKey(origin))!.data} : await this.db!.getFirstAsync<{value:string}>('SELECT value FROM app_cache WHERE key = ?', cacheKey(origin)); if (row) { const parsed = JSON.parse(row.value); if (parsed.version !== 1 || parsed.origin !== origin || !parsed.payload) throw new Error('Gateway cache is invalid.'); target = parsed.payload; } target = await this.withDraftCheckpoint(target, origin); }
        if (binding) {
          this.commitSource = ''; this.commitTarget = origin; this.commitTargetPayload = target;
          const unbound = {sessions:this.state.sessions,chats:this.state.chats,drafts:this.state.drafts,outbox:this.state.outbox,queuedEdits:this.state.queuedEdits,historyTruncated:this.state.historyTruncated,nextOrdinal:this.nextOrdinal,recent:this.recent,draftRevision:this.draftRevision};
          target = this.mergeUnbound(target, unbound);
          await this.db!.runAsync('INSERT OR REPLACE INTO app_cache (key, value) VALUES (?, ?)', cacheKey(origin), JSON.stringify({version:1, origin, payload:target}));
        }
        if (this.disposed) throw new Error('Manager disposed');
        if (changing && this.hasUnreconciled()) throw new Error('Resolve drafts and pending messages before changing gateways.');
        if (changing || !this.baseUrl) { this.commitSource = this.baseUrl; this.commitTarget = origin; }
        await SecureStore.setItemAsync(CONFIG, JSON.stringify(credentials));
        if (this.disposed) { this.credentials = credentials; this.baseUrl = origin; return; }
        const previous = this.client; this.endpointEpoch++; conversationDiagnostics.setEnabled(false);this.diagnosticSubmissions.clear();this.imageReads.clear(); this.credentials = credentials; this.baseUrl = origin; this.client = candidate; candidate = null;
        if (this.eventTimer) clearTimeout(this.eventTimer); this.eventTimer = null; this.events = []; this.snapshotCutoffs.clear(); this.transcriptVersions.clear(); this.secret?.reject(new Error('Gateway changed')); this.secret = null;
        if (changing || binding) { const pending = this.pendingCaches.get(cacheKey(origin)); this.restoreCache(pending && binding ? JSON.parse(pending.data).payload : target); }
        this.update({credentialsConfigured:true, connection:staged.client.connectionState, error:null, secureRequest:null}); previous?.close(); staged.activate();
        this.commitSource = null; this.commitTarget = null; this.commitTargetPayload = null;
        try { await this.writes; } catch { /* retry each retained origin below */ }
        let failed = false;
        for (const [key, stash] of [...this.pendingCaches]) {
          const write = this.writes.catch(() => {}).then(async () => { if (this.pendingCaches.get(key) !== stash) return; await this.db!.runAsync('INSERT OR REPLACE INTO app_cache (key, value) VALUES (?, ?)', key, stash.data); if (this.pendingCaches.get(key) === stash) this.pendingCaches.delete(key); });
          this.writes = write;
          try { await write; } catch { failed = true; }
        }
        if (failed) this.update({error:'Could not save a previous gateway draft. It will be retried.'});
      });
    } finally { if (candidate && !this.baseUrl && this.commitTarget) this.pendingCaches.delete(cacheKey(this.commitTarget)); this.commitSource = null; this.commitTarget = null; this.commitTargetPayload = null; candidate?.close(); this.configuring = false; }
  };
  private startClient(credentials: Credentials) { const staged = this.makeClient(credentials); this.client = staged.client; staged.activate(); }
  private makeClient(credentials: Credentials) {
    let active = false;
    const client = new CanonicalClient({ clientIdentity: {name:'hermes-mobile', version:buildVersion}, baseUrl: credentials.origin, getToken: async () => credentials.token,
      onState: connection => { if (this.client !== client || !active) return; this.update({ connection }); if (active && connection === 'ready') { void this.refreshSessions().catch(() => {}); void this.reopen().catch(() => {}); } },
      onSnapshot: (sessionId, snapshot, reason) => { if (this.client !== client || !active) return; this.transcriptVersions.set(sessionId, (this.transcriptVersions.get(sessionId) ?? 0) + 1); this.flushEvents(); this.snapshotCutoffs.set(sessionId, { epoch: snapshot.replay_epoch, sequence: snapshot.last_sequence, running: snapshot.running === true }); this.setChat(sessionId, snapshotChat(snapshot, this.state.chats[sessionId], reason === 'rebuild')); void reconcileSnapshot(credentials.origin, sessionId, snapshot).catch(() => {});  },
      onEvent: event => { if (this.client !== client || !active) return; if (this.isCoveredBySnapshot(event)) return; if(event.type==='message.complete' && event.session_id){const submission=asObject(asObject(event.payload).persisted_turn).submission_id ?? this.state.chats[event.session_id]?.localMessages.find(row=>row.admission_id && row.admission_id===event.admission_id)?.submission_id;const trace=typeof submission==='string'?this.diagnosticSubmissions.get(submission):undefined;if(trace!==undefined && trace.sessionId===event.session_id){conversationDiagnostics.mark(trace.trace,'reply_complete');conversationDiagnostics.end(trace.trace);this.diagnosticSubmissions.delete(submission);}} for (const listener of this.voiceListeners) { try { listener(event); } catch {} } void notifyEvent(credentials.origin, event).catch(() => {}); if (event.type === 'sessions.changed') { void this.refreshSessions().catch(() => {}); return; } this.events.push(event); if (event.type === 'message.complete' && event.session_id) void this.refreshTranscript(event.session_id).catch(() => {}); if (!this.eventTimer) this.eventTimer = setTimeout(() => this.flushEvents(), 50); },
      onSessionUnavailable: sessionId => { if (this.client === client && active) void this.forgetSession(sessionId, true).catch(() => this.update({error:'Could not save session recovery.'})); },
      onPartialUnavailable: sessionId => { if (this.client !== client || !active) return; const chat = this.state.chats[sessionId] ?? emptyChat(); this.setChat(sessionId, { ...chat, partialUnavailable: true }); },
      persistSubmission: async submission => { if (this.client !== client || !active) throw new Error('Gateway changed'); if (!this.state.outbox.some(x => x.submission_id === submission.submission_id)) throw new Error('Submission is no longer queued'); await this.persist(); },
      acknowledgeSubmission: async (submission, receipt) => { if (this.client !== client || !active) throw new Error('Gateway changed'); const key = `outbox:${submission.submission_id}`, version = this.version(key), saved = this.state.outbox.find(x => x.submission_id === submission.submission_id); const chat = this.state.chats[submission.session_id] ?? emptyChat(); const admission = asObject(receipt).admission_id; this.update({ chats: { ...this.state.chats, [submission.session_id]: { ...chat, localMessages: (chat.localMessages ?? []).map(x => x.submission_id === submission.submission_id ? { ...x, status: 'accepted', ...(typeof admission === 'string' ? {admission_id: admission} : {}) } : x) } }, outbox: this.state.outbox.filter(x => x.submission_id !== submission.submission_id) }); try { await this.persist(); } catch (error) { if (this.client === client && saved && this.operationVersions.get(key) === version && !this.state.outbox.some(x => x.submission_id === submission.submission_id)) { this.update({ outbox: restorePosition(this.state.outbox, saved!) }); try { await this.persist(); } catch {} } throw error; } },
      requestSecret: (method, params, signal) => new Promise((resolve, reject) => { if (this.client !== client || !active || signal.aborted) { reject(new Error('Request cancelled')); return; } this.secret?.reject(new Error('Superseded')); const request = { method, params }; this.secret = { request, resolve, reject }; this.update({ secureRequest: request }); signal.addEventListener('abort', () => { if (this.secret?.resolve === resolve) { this.secret = null; this.update({ secureRequest: null }); reject(new Error('Request cancelled')); } }, { once: true }); })
    });
    return {client, activate: () => { active = true; if (this.client === client && this.state.connection === 'ready') { void this.refreshSessions().catch(() => {}); void this.reopen().catch(() => {}); } }};
  }
  private isCoveredBySnapshot(event: GatewayEvent) { const cutoff = event.session_id && this.snapshotCutoffs.get(event.session_id); if (!cutoff || event.replay_epoch !== cutoff.epoch || typeof event.seq !== 'number' || event.seq > cutoff.sequence) return false; const type = event.type as string; if (['session.info','session.usage','approval.request','approval.settled','approval.cancelled','clarify.request','clarify.settled','message.complete'].includes(type)) return true; return !cutoff.running && (type === 'message.start' || type === 'message.delta'); }
  private syncRows(chats: Record<string,ChatState>, affected: Set<string>, unread = new Set<string>()) {
    let changed = false;
    const rows = this.state.sessions.map(row => {
      if (!affected.has(row.id)) return row;
      const chat = chats[row.id];
      const flags = {needs_attention:!!chat?.prompts.length, running:!!chat?.running, session_unavailable:!!chat?.sessionUnavailable, unread:!!row.unread || (row.id !== this.state.activeSessionId && unread.has(row.id))};
      if (Object.entries(flags).every(([key,value]) => !!row[key] === value)) return row;
      changed = true; return {...row,...flags};
    });
    return changed ? rows : this.state.sessions;
  }
  private setChat(sessionId: string, chat: ChatState) { const chats = {...this.state.chats,[sessionId]:chat}; this.update({chats,sessions:this.syncRows(chats,new Set([sessionId]))}); this.scheduleCache(); }
  private flushEvents() {
    if (this.eventTimer) clearTimeout(this.eventTimer); this.eventTimer = null; if (!this.events.length) return;
    const events = this.events.splice(0), chats = {...this.state.chats}, affected = new Set<string>(), unread = new Set<string>();
    for (const event of events) if (event.session_id) {
      affected.add(event.session_id); chats[event.session_id] = reduceEvent(chats[event.session_id] ?? emptyChat(), event);
      if (['message.complete','approval.request','clarify.request'].includes(event.type)) unread.add(event.session_id);
    }
    this.update({chats,sessions:this.syncRows(chats,affected,unread)}); this.scheduleCache();
  }
  private resolveSessionAlias(alias: string, canonicalId: string, client: CanonicalClient) {
    if (alias === canonicalId) return Promise.resolve();
    const epoch = this.endpointEpoch;
    return this.queueMutation(async () => {
      this.assertEndpointEpoch(epoch); if (this.client !== client) throw new Error('Gateway changed');
      const drafts = {...this.state.drafts};
      if (drafts[alias] && !drafts[canonicalId]) { drafts[canonicalId] = drafts[alias]; delete drafts[alias]; }
      const source = this.state.chats[alias], target = this.state.chats[canonicalId] ?? source ?? emptyChat();
      const alternatives = new Set([...(target.draftAlternatives ?? []), ...(source?.draftAlternatives ?? [])]);
      if (drafts[alias]) alternatives.add(alias);
      const localMessages = [...target.localMessages];
      for (const message of source?.localMessages ?? []) if (!localMessages.some(x => x.submission_id === message.submission_id)) localMessages.push(message);
      localMessages.sort((a,b) => a.enqueue_order - b.enqueue_order);
      const authoritative = target.messages.map(asObject);
      const unmatched = localMessages.filter(local => !authoritative.some(row => row.submission_id === local.submission_id || (row.row_id != null && local.row_ids?.includes(row.row_id))));
      const chats = {...this.state.chats, [canonicalId]:{...target, localMessages:unmatched, draftAlternatives:[...alternatives],draftAttachments:mergeDraftImages(source?.draftAttachments,target.draftAttachments),importedShareIds:[...new Set([...(source?.importedShareIds ?? []),...(target.importedShareIds ?? [])])].slice(-100)}}; delete chats[alias];
      this.recent = [...new Set(this.recent.map(x => x === alias ? canonicalId : x))];
      this.update({drafts, chats, outbox:this.state.outbox.map(x => x.session_id === alias ? {...x, session_id:canonicalId} : x), queuedEdits:this.state.queuedEdits.map(x => x.session_id === alias ? {...x, session_id:canonicalId} : x), ...(this.state.activeSessionId === alias ? {activeSessionId:canonicalId} : {})});
      await this.persist();
    });
  }
  private async reopen() { const client = this.client; if (!client) return; for (const sessionId of this.recent) { try { const snapshot = await client.openSession(sessionId); if (this.client !== client) return; await this.resolveSessionAlias(sessionId, snapshot.session_id, client); if (this.client !== client) return; void this.recoverReceipts(snapshot.session_id, client); } catch { break; } } if (this.client === client) await this.drain(); }
  private async drain() {
    const client = this.client, epoch = this.endpointEpoch;
    if (this.draining && this.drainEpoch === epoch) { this.drainRequested = true; return; }
    if (!client || this.state.connection !== 'ready') return;
    this.draining = true; this.drainEpoch = epoch; this.drainRequested = false;
    try {
      while (this.client === client && this.endpointEpoch === epoch && this.state.connection === 'ready') {
        for (;;) { const barrier = this.mutations; await barrier; if (barrier === this.mutations) break; }
        const pick = () => [
          ...this.state.outbox.filter(x => !x.error).map(item => ({ kind: 'submit' as const, item })),
          ...this.state.queuedEdits.filter(x => !x.error).map(item => ({ kind: 'edit' as const, item })),
        ].sort((a,b) => a.item.enqueue_order - b.item.enqueue_order)[0];
        if (this.client !== client || this.endpointEpoch !== epoch) return;
        const selected = pick(); if (!selected) break;
        try {
          const snapshot = await client.openSession(selected.item.session_id); if (this.client !== client || this.endpointEpoch !== epoch) return;
          if (snapshot.session_id !== selected.item.session_id) { await this.resolveSessionAlias(selected.item.session_id, snapshot.session_id, client); continue; }
          for (;;) { const barrier = this.mutations; await barrier; if (barrier === this.mutations) break; }
          if (this.client !== client || this.endpointEpoch !== epoch) return;
          const current = pick();
          if (!current || current.kind !== selected.kind || current.item !== selected.item) continue;
          if (current.kind === 'submit') {
            const { session_id, submission_id, text, attachments } = current.item;
            await client.submit({ session_id, submission_id, text, ...(attachments ? {attachments} : {}) });
          } else {
            const { session_id, submission_id, admission_id, text } = current.item;
            await client.request('prompt.replace_queued', {session_id, submission_id, admission_id, text});
            if (this.client !== client || this.endpointEpoch !== epoch) return;
            const key = `edit:${submission_id}`, version = this.version(key);
            this.update({ queuedEdits: this.state.queuedEdits.filter(x => x.submission_id !== submission_id) });
            try { await this.persist(); } catch (error) {
              if (this.operationVersions.get(key) === version) { this.update({ queuedEdits: restorePosition(this.state.queuedEdits, current.item) }); try { await this.persist(); } catch {} }
              throw error;
            }
          }
        } catch (error) {
          if (!(error instanceof JsonRpcGatewayError)) return;
          for (;;) { const barrier = this.mutations; await barrier; if (barrier === this.mutations) break; }
          if (this.client !== client || this.endpointEpoch !== epoch) return;
          const current = pick();
          if (!current || current.kind !== selected.kind || current.item !== selected.item) continue;
          if (selected.kind === 'submit') {
            this.version(`outbox:${selected.item.submission_id}`);
            const chat = this.state.chats[selected.item.session_id] ?? emptyChat();
            this.update({ chats: { ...this.state.chats, [selected.item.session_id]: { ...chat, localMessages: (chat.localMessages ?? []).map(x => x.submission_id === selected.item.submission_id ? { ...x, status: 'failed' } : x) } }, outbox: this.state.outbox.map(x => x.submission_id === selected.item.submission_id ? { ...x, error: 'The gateway rejected this message. Copy it to the draft or discard it.' } : x) });
          } else {
            this.version(`edit:${selected.item.submission_id}`);
            this.update({ queuedEdits: this.state.queuedEdits.map(x => x.submission_id === selected.item.submission_id ? { ...x, error: 'The gateway rejected this edit. Copy it to the draft or discard it.' } : x) });
          }
          try { await this.persist(); } catch { this.update({ error: 'Could not save queue status.' }); return; }
        }
      }
    } finally { if (this.drainEpoch === epoch) { this.draining = false; if (this.drainRequested) void this.drain(); } }
  }
  private async refreshTranscript(sessionId: string) {
    const client = this.requireClient(); const version = (this.transcriptVersions.get(sessionId) ?? 0) + 1; this.transcriptVersions.set(sessionId, version);
    const result = await client.request<{rows: unknown[]; reset?: boolean; next_cursor?: string | null}>('session.transcript', {session_id:sessionId, order:'latest', limit:50});
    if (this.client !== client || this.transcriptVersions.get(sessionId) !== version) return;
    this.flushEvents(); const chat = this.state.chats[sessionId] ?? emptyChat();
    const incoming = new Set(result.rows.map(x => asObject(x).row_id).filter(x => x != null));
    const retained = chat.messages.filter(x => { const row = asObject(x); return row.row_id == null || !incoming.has(row.row_id); });
    this.setChat(sessionId, { ...chat, messages:result.reset ? result.rows : [...retained, ...result.rows], ...(result.reset ? {cursor:result.next_cursor ?? null} : {}), localMessages: (chat.localMessages ?? []).filter(local => !local.row_ids?.some(rowId => incoming.has(rowId)) && !result.rows.some(row => asObject(row).submission_id === local.submission_id)), liveText: chat.running ? chat.liveText : '' });
  }
  private async recoverReceipts(sessionId: string, client: CanonicalClient) {
    for (const local of this.state.chats[sessionId]?.localMessages ?? []) {
      if (local.status !== 'accepted' || !local.admission_id) continue;
      try {
        const receipt = await client.request<{status?: string}>('prompt.receipt', {session_id:sessionId, admission_id:local.admission_id, include_result:true});
        if (this.client !== client) return;
        if (receipt.status === 'terminal') { const chat = this.state.chats[sessionId] ?? emptyChat(); this.setChat(sessionId, {...chat, localMessages: chat.localMessages.map(x => x.submission_id === local.submission_id ? {...x, status:'completed'} : x)}); }
      } catch { /* Keep the accepted copy when receipt evidence is unavailable. */ }
    }
  }
  goHome = () => this.update({ activeSessionId: null });
  private loadSessions = async (client: CanonicalClient, epoch: number) => { const [live, stored] = await Promise.all([client.request<{sessions: SessionRow[]}>('session.list', {scope:'live',limit:200,picker:true}), client.request<{sessions: SessionRow[]}>('session.list', {scope:'stored',limit:200,picker:true})]); this.assertEndpointEpoch(epoch); this.update({ historyTruncated: stored.sessions.length >= 200, sessions: [...mergeSessions(live.sessions, stored.sessions).map(row => ({ ...row, unread: !!this.state.sessions.find(old => old.id === row.id)?.unread, needs_attention: !!this.state.chats[row.id]?.prompts.length })), ...this.state.sessions.filter(row => this.state.chats[row.id]?.sessionUnavailable && !live.sessions.some(x => (x.id || x.session_id || x.resolved_id) === row.id) && !stored.sessions.some(x => (x.id || x.session_id || x.resolved_id) === row.id))] }); await this.persist(); };
  refreshSessions = (): Promise<void> => {
    const client = this.requireClient(), epoch = this.endpointEpoch;
    if (this.inventoryFlight?.client === client && this.inventoryFlight.epoch === epoch) {
      this.inventoryFlight.again = true; return this.inventoryFlight.promise;
    }
    const flight = {client, epoch, again:false, promise:Promise.resolve()};
    this.inventoryFlight = flight;
    flight.promise = (async () => {
      do {
        flight.again = false;
        await this.loadSessions(client, epoch);
        this.assertEndpointEpoch(epoch);
      } while (flight.again);
    })().finally(() => { if (this.inventoryFlight === flight) this.inventoryFlight = null; });
    return flight.promise;
  };
  findByTitle = async (title: string) => { const result = await this.request<{sessions: SessionRow[]}>('session.list', {title}); return mergeSessions([], result.sessions); };
  openSession = async (sessionId: string) => { this.flushEvents(); const epoch = this.endpointEpoch; this.update({ activeSessionId: sessionId, sessions: this.state.sessions.map(row => row.id === sessionId ? { ...row, unread: false } : row) }); this.recent = [sessionId, ...this.recent.filter(x => x !== sessionId)]; while (this.recent.length > 8) { const index = this.recent.findLastIndex(x => x !== sessionId && !this.state.chats[x]?.running && !this.state.chats[x]?.prompts.length && !this.state.chats[x]?.pending.length); if (index < 0) break; const [old] = this.recent.splice(index, 1); void this.client?.detachSession(old).catch(() => {}); } this.trimIdleChats(); await this.persist(); this.assertEndpointEpoch(epoch); if (this.state.connection !== 'ready' || this.state.chats[sessionId]?.sessionUnavailable) return sessionId; const client = this.requireClient(); const snapshot = await client.openSession(sessionId); if (this.client !== client) return; await this.resolveSessionAlias(sessionId, snapshot.session_id, client); void this.recoverReceipts(snapshot.session_id, client); return snapshot.session_id; };
  createSession = async (options: Record<string, unknown> = {}) => { const epoch = this.endpointEpoch; const client = this.requireClient(); const snapshot = await client.createSession(options); this.assertEndpointEpoch(epoch); const resolved=await this.openSession(snapshot.session_id); await this.refreshSessions(); return resolved ?? snapshot.session_id; };
  setDraft = (sessionId: string, text: string) => { if (this.state.drafts[sessionId] === text) return; this.draftVersions.set(sessionId, (this.draftVersions.get(sessionId) ?? 0) + 1); this.update({ drafts: { ...this.state.drafts, [sessionId]: text } }); void this.checkpointWarning('draft', this.persistDrafts(), 'Could not save your draft.').catch(() => {}); };
  setDraftAttachments = (sessionId:string, attachments:NonNullable<ChatState['draftAttachments']>) => {
    const previous=this.state.chats[sessionId]?.draftAttachments ?? [];
    if(attachments.length>10&&attachments.length>=previous.length)throw new Error('A prompt can include up to 10 images. Remove images before sending.');
    this.version(`attachments:${sessionId}`);
    const chat=this.state.chats[sessionId] ?? emptyChat();
    this.setChat(sessionId,{...chat,draftAttachments:attachments});
    return this.checkpointWarning('images', this.persist(), 'Could not save draft images. Keep the app open and try again.');
  };
  importSharedDraft = (sessionId:string,shareId:string,text:string,images:NonNullable<ChatState['draftAttachments']>,valid?:()=>boolean) => this.queueForEndpoint(async()=>{
    if(valid&&!valid())throw new Error('Share preparation was cancelled.');
    if(!/^[a-f0-9-]{36}$/i.test(shareId)||text.length>100000)throw new Error('This share is invalid or too large.');
    const prior=Object.entries(this.state.chats).find(([,chat])=>chat.importedShareIds?.includes(shareId));
    if(prior){if(prior[0]!==sessionId)throw new Error('This share was already added to another chat.');await this.persist();return;}
    const chat=this.state.chats[sessionId] ?? emptyChat();
    if(chat.sessionUnavailable)throw new Error('This session is unavailable.');
    const attachments=[...(chat.draftAttachments ?? []),...images];
    if(attachments.length>10)throw new Error('This draft already has images. A prompt can include up to 10.');
    const existing=this.state.drafts[sessionId] ?? '';
    const combined=text.trim() ? `${existing}${existing ? '\n\n' : ''}${text}` : existing;
    this.draftVersions.set(sessionId,(this.draftVersions.get(sessionId) ?? 0)+1);
    this.version(`attachments:${sessionId}`);
    this.update({drafts:{...this.state.drafts,[sessionId]:combined},chats:{...this.state.chats,[sessionId]:{...chat,draftAttachments:attachments,importedShareIds:[...(chat.importedShareIds ?? []),shareId].slice(-100)}}});
    // Keep the in-memory draft and source inbox on failure. Retrying the same share checkpoints
    // the current draft without appending it twice; no prompt is submitted by importing.
    try{await this.persist();}catch(error){this.update({error:'Could not save the shared draft. The original share is still in your inbox.'});throw error;}
  });
  swapAliasDraft = (sessionId: string, aliasId: string) => {
    const chat = this.state.chats[sessionId]; if (!chat?.draftAlternatives?.includes(aliasId)) return;
    const drafts = {...this.state.drafts, [sessionId]:this.state.drafts[aliasId] ?? '', [aliasId]:this.state.drafts[sessionId] ?? ''};
    this.draftVersions.set(sessionId, (this.draftVersions.get(sessionId) ?? 0) + 1); this.draftVersions.set(aliasId, (this.draftVersions.get(aliasId) ?? 0) + 1);
    const alternatives = drafts[aliasId] ? chat.draftAlternatives : chat.draftAlternatives.filter(x => x !== aliasId);
    this.update({drafts, chats:{...this.state.chats, [sessionId]:{...chat, draftAlternatives:alternatives}}}); void this.persist().catch(() => this.update({error:'Could not save recovered draft.'}));
  };
  replaceDraftIfUnchanged = (sessionId: string, captured: string, replacement: string) => { if ((this.state.drafts[sessionId] ?? '') === captured) this.setDraft(sessionId, replacement); };
  send = (sessionId: string, text = this.state.drafts[sessionId] ?? '', attachments?: Array<{path: string; mime: string}>, options?: {preserveDraft?:boolean; valid?:()=>boolean}) => this.queueForEndpoint(() => { if (options?.valid && !options.valid()) throw new Error('Voice session ended'); return this.sendWork(sessionId, text, attachments, !!options?.preserveDraft); });
  private sendWork = async (sessionId: string, text = this.state.drafts[sessionId] ?? '', attachments?: Array<{path: string; mime: string}>, preserveDraft = false) => { if (this.state.chats[sessionId]?.sessionUnavailable) throw new Error('This session is unavailable.'); if (!text.trim() && !attachments?.length) return; if(attachments && attachments.length>10)throw new Error('A prompt can include up to 10 images. Remove images before sending.'); const submission: PendingSubmission & {enqueue_order:number} = { session_id: sessionId, submission_id: id(), text, enqueue_order:this.nextOrdinal++,  ...(attachments?.length ? {attachments} : {}) }; const trace=preserveDraft?null:conversationDiagnostics.begin();if(trace!==null){conversationDiagnostics.mark(trace,'submission_start');this.diagnosticSubmissions.set(submission.submission_id,{trace,sessionId});while(this.diagnosticSubmissions.size>500)this.diagnosticSubmissions.delete(this.diagnosticSubmissions.keys().next().value!);} const previousDraft = this.state.drafts[sessionId]; const draftVersion = this.draftVersions.get(sessionId) ?? 0; const previousChat = this.state.chats[sessionId] ?? emptyChat(); const attachmentVersion=this.operationVersions.get(`attachments:${sessionId}`); const sentPaths=new Set(preserveDraft?[]:(attachments ?? []).map(a=>a.path)); const chat = { ...previousChat, draftAttachments:(previousChat.draftAttachments ?? []).filter(a=>!sentPaths.has(a.path)), localMessages: [...(previousChat.localMessages ?? []), { ...submission, status: 'pending' as const }] }; this.update({ chats: { ...this.state.chats, [sessionId]: chat }, outbox: [...this.state.outbox, submission], drafts: { ...this.state.drafts, [sessionId]: !preserveDraft && previousDraft === text ? '' : (previousDraft ?? '') } }); try { await this.persist(); conversationDiagnostics.mark(trace,'submission_saved'); } catch (error) { this.diagnosticSubmissions.delete(submission.submission_id);conversationDiagnostics.end(trace);this.update({ chats: { ...this.state.chats, [sessionId]: { ...(this.state.chats[sessionId] ?? previousChat), localMessages: (this.state.chats[sessionId]?.localMessages ?? []).filter(x => x.submission_id !== submission.submission_id), draftAttachments:this.operationVersions.get(`attachments:${sessionId}`)===attachmentVersion ? previousChat.draftAttachments : mergeDraftImages((previousChat.draftAttachments ?? []).filter(image=>sentPaths.has(image.path)),this.state.chats[sessionId]?.draftAttachments) } }, outbox: this.state.outbox.filter(x => x.submission_id !== submission.submission_id), drafts: { ...this.state.drafts, [sessionId]: !preserveDraft && (this.draftVersions.get(sessionId) ?? 0) === draftVersion ? (previousDraft ?? text) : (this.state.drafts[sessionId] ?? '') } }); try { await this.persist(); } catch {} throw error; } void this.drain(); return submission.submission_id; };
  forgetSession = async (sessionId: string, preserveLocal = false) => {
    this.transcriptVersions.set(sessionId,(this.transcriptVersions.get(sessionId) ?? 0) + 1);
    this.recent = this.recent.filter(x => x !== sessionId);
    const chat = this.state.chats[sessionId] ?? emptyChat();
    const hasRecovery = preserveLocal && (!!(this.state.drafts[sessionId] ?? '').length || !!chat.draftAttachments?.length || this.state.outbox.some(x => x.session_id === sessionId) || this.state.queuedEdits.some(x => x.session_id === sessionId) || !!chat.localMessages.length || !!chat.draftAlternatives?.length);
    const chats = {...this.state.chats};
    if (hasRecovery) chats[sessionId] = {...chat, sessionUnavailable:true, running:false, prompts:[], pending:[], liveText:'', blocks:[], localMessages:chat.localMessages.map(x => this.state.outbox.some(item => item.submission_id === x.submission_id) ? {...x, status:'failed' as const} : x)}; else delete chats[sessionId];
    const existing = this.state.sessions.find(x => x.id === sessionId);
    const sessions = this.state.sessions.filter(x => x.id !== sessionId);
    if (hasRecovery) sessions.push({...existing, id:sessionId, is_live:false, running:false, session_unavailable:true});
    this.update({chats, sessions, ...(hasRecovery ? {outbox:this.state.outbox.map(x => x.session_id === sessionId ? {...x, error:'This session is unavailable. Copy this message to a draft or discard it.'} : x), queuedEdits:this.state.queuedEdits.map(x => x.session_id === sessionId ? {...x, error:'This session is unavailable. Copy this edit to a draft or discard it.'} : x)} : {}), ...(!hasRecovery && this.state.activeSessionId === sessionId ? {activeSessionId:null} : {})});
    await this.persist();
  };
  mutate = async (sessionId: string, operation: string, payload: Record<string, unknown>) => {
    const client = this.requireClient();
    if (operation === 'delete' && ((this.state.drafts[sessionId] ?? '').length || this.state.chats[sessionId]?.draftAttachments?.length || this.state.outbox.some(x => x.session_id === sessionId) || this.state.queuedEdits.some(x => x.session_id === sessionId))) {
      throw new Error('Resolve the draft and queued messages before deleting this session.');
    }
    await client.openSession(sessionId);
    if (this.client !== client) throw new Error('Gateway changed');
    const result = await client.mutate(sessionId, operation, payload);
    if (this.client !== client) return result;
    if (operation === 'delete') {
      await client.detachSession(sessionId).catch(() => {});
      if (this.client !== client) return result;
      await this.forgetSession(sessionId, true);
      if (this.client !== client) return result;
    }
    await this.refreshSessions();
    return result;
  };
  request = async <T = any>(method: string, params: Record<string, unknown> = {}) => { const client = this.requireClient(); const epoch = this.endpointEpoch; const result = await client.request<T>(method, params); this.assertEndpointEpoch(epoch); return result; };
  respondNotificationApproval = async (data: Record<string, unknown>, choice: string) => {
    const deadline = Date.now() + 15000;
    const timeout = <T,>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Timed out')), Math.max(0, deadline - Date.now())); work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
    await timeout(this.initialize());
    const epoch = this.endpointEpoch, client = this.requireClient(), origin = this.baseUrl;
    if (data.origin !== origin || typeof data.session !== 'string' || typeof data.prompt !== 'string') throw new Error('Request no longer matches this gateway');
    await timeout(client.connect());
    this.assertEndpointEpoch(epoch); if (this.client !== client || Date.now() >= deadline) throw new Error('Gateway changed');
    const snapshot = await timeout(client.refreshSession(data.session));
    this.assertEndpointEpoch(epoch); if (this.client !== client || Date.now() >= deadline || !validAction(data, origin, snapshot, choice)) throw new Error('Approval is no longer available');
    await timeout(client.request('approval.respond', {session_id:data.session, execution_generation:snapshot.execution_generation, prompt_id:data.prompt, choice}));
    this.assertEndpointEpoch(epoch);
  };
  respondApproval = (sessionId: string, promptId: string, choice: string) => this.request('approval.respond', {session_id:sessionId, execution_generation:this.promptGeneration(sessionId,promptId), prompt_id:promptId, choice});
  respondClarify = (sessionId: string, promptId: string, answer: unknown) => this.request('clarify.respond', {session_id:sessionId, execution_generation:this.promptGeneration(sessionId,promptId), prompt_id:promptId, answer});
  private promptGeneration(sessionId: string, promptId: string) { return asObject(this.state.chats[sessionId]?.prompts.find(p => asObject(p).prompt_id === promptId)).execution_generation ?? this.generation(sessionId); }
  private generation(sessionId: string) { return this.state.chats[sessionId]?.snapshot?.execution_generation ?? this.requireClient().getSession(sessionId)?.execution_generation; }
  answerSecret = (request: NonNullable<AppState['secureRequest']>, value: string) => {
    const pending = this.secret;
    if (!pending || pending.request !== request) return;
    this.secret = null;
    this.update({ secureRequest: null });
    pending.resolve(value);
  };
  cancelSecret = (request: NonNullable<AppState['secureRequest']>) => {
    const pending = this.secret;
    if (!pending || pending.request !== request) return;
    this.secret = null;
    this.update({ secureRequest: null });
    pending.reject(new Error('Request cancelled'));
  };
  captureDraft = (sessionId: string) => ({
    epoch:this.endpointEpoch,
    version:this.draftVersions.get(sessionId) ?? 0,
    text:this.state.drafts[sessionId] ?? '',
  });
  replaceCapturedDraft = (sessionId: string, captured: ReturnType<AppManager['captureDraft']>, replacement: string) => {
    if (captured.epoch === this.endpointEpoch && captured.version === (this.draftVersions.get(sessionId) ?? 0) && captured.text === (this.state.drafts[sessionId] ?? '')) {
      this.setDraft(sessionId, replacement);
    }
  };
  stop = (sessionId: string) => this.request('session.interrupt', {session_id: sessionId, execution_generation: this.generation(sessionId)});
  steer = async (sessionId: string, text: string) => { const epoch = this.endpointEpoch; const result = await this.request<Record<string, unknown> | null>('session.steer', {session_id:sessionId, execution_generation:this.generation(sessionId), text}); this.assertEndpointEpoch(epoch); if (result?.status === 'queued' || result?.status === 'redirected') return result; if (result?.status === 'rejected' && result.delivered === false) { await this.send(sessionId,text); return result; } throw new Error('Steer delivery is uncertain. Your draft was kept.'); };
  cancelQueued = (sessionId: string, admissionId: string) => this.request('prompt.cancel', {session_id:sessionId, admission_id:admissionId});
  steerQueued = (sessionId: string, admissionId: string) => this.request('prompt.steer_queued', {session_id:sessionId, admission_id:admissionId});
  replaceQueued = (sessionId: string, admissionId: string, text: string) => this.queueForEndpoint(() => this.replaceQueuedWork(sessionId, admissionId, text));
  discardOutbox = (submissionId: string) => this.queueForEndpoint(() => this.discardOutboxWork(submissionId));
  retryOutbox = (submissionId: string) => this.queueForEndpoint(() => this.retryOutboxWork(submissionId));
  discardQueuedEdit = (submissionId: string) => this.queueForEndpoint(() => this.discardQueuedEditWork(submissionId));
  retryQueuedEdit = (submissionId: string) => this.queueForEndpoint(() => this.retryQueuedEditWork(submissionId));
  private replaceQueuedWork = async (sessionId: string, admissionId: string, text: string) => { if (this.state.chats[sessionId]?.sessionUnavailable) throw new Error('This session is unavailable.'); const edit: QueuedEdit = {session_id:sessionId, admission_id:admissionId, submission_id:id(), text, enqueue_order:this.nextOrdinal++}; this.update({ queuedEdits: [...this.state.queuedEdits, edit] }); try { await this.persist(); } catch (error) { this.update({ queuedEdits: this.state.queuedEdits.filter(x => x.submission_id !== edit.submission_id) }); try { await this.persist(); } catch {} throw error; } void this.drain(); };
  private discardOutboxWork = async (submissionId: string) => {
    const key = `outbox:${submissionId}`, version = this.version(key);
    const item = this.state.outbox.find(x => x.submission_id === submissionId);
    if (!item) return;
    const local = this.state.chats[item.session_id]?.localMessages?.find(x => x.submission_id === submissionId);
    const chat = this.state.chats[item.session_id];
    this.update({ outbox: this.state.outbox.filter(x => x.submission_id !== submissionId), ...(chat ? { chats: { ...this.state.chats, [item.session_id]: { ...chat, localMessages: (chat.localMessages ?? []).filter(x => x.submission_id !== submissionId) } } } : {}) });
    try { await this.persist(); } catch (error) {
      if (this.operationVersions.get(key) === version) { const current = this.state.chats[item.session_id] ?? emptyChat(); this.update({ outbox: restorePosition(this.state.outbox, item), ...(local ? { chats: { ...this.state.chats, [item.session_id]: { ...current, localMessages: restorePosition(current.localMessages ?? [], local) } } } : {}) }); try { await this.persist(); } catch {} }
      throw error;
    }
  };
  private retryOutboxWork = async (submissionId: string) => {
    const key = `outbox:${submissionId}`, version = this.version(key); const old = this.state.outbox.find(x => x.submission_id === submissionId); if (!old) return; if (this.state.chats[old.session_id]?.sessionUnavailable) throw new Error('This session is unavailable.');
    const { error: _error, ...pending } = old;
    this.update({ outbox: this.state.outbox.map(x => x.submission_id === submissionId ? pending : x) });
    try { await this.persist(); } catch (error) { if (this.operationVersions.get(key) === version) { this.update({ outbox: this.state.outbox.map(x => x === pending ? old : x) }); try { await this.persist(); } catch {} } throw error; }
    void this.drain();
  };
  private discardQueuedEditWork = async (submissionId: string) => {
    const key = `edit:${submissionId}`, version = this.version(key); const old = this.state.queuedEdits.find(x => x.submission_id === submissionId); if (!old) return;
    this.update({ queuedEdits: this.state.queuedEdits.filter(x => x.submission_id !== submissionId) });
    try { await this.persist(); } catch (error) { if (this.operationVersions.get(key) === version && !this.state.queuedEdits.some(x => x.submission_id === submissionId)) { this.update({ queuedEdits: restorePosition(this.state.queuedEdits, old) }); try { await this.persist(); } catch {} } throw error; }
  };
  private retryQueuedEditWork = async (submissionId: string) => {
    const key = `edit:${submissionId}`, version = this.version(key); const old = this.state.queuedEdits.find(x => x.submission_id === submissionId); if (!old) return; if (this.state.chats[old.session_id]?.sessionUnavailable) throw new Error('This session is unavailable.');
    const { error: _error, ...pending } = old;
    this.update({ queuedEdits: this.state.queuedEdits.map(x => x.submission_id === submissionId ? pending : x) });
    try { await this.persist(); } catch (error) { if (this.operationVersions.get(key) === version) { this.update({ queuedEdits: this.state.queuedEdits.map(x => x === pending ? old : x) }); try { await this.persist(); } catch {} } throw error; }
    void this.drain();
  };
  modelOptions = (sessionId?: string) => this.request('model.options', {...(sessionId ? {session_id:sessionId} : {}), explicit_only:true});
  command = (sessionId: string, name: string, arg = '') => this.request('command.dispatch', {session_id:sessionId, name, arg});
  loadEarlier = async (sessionId: string) => { const client = this.requireClient(), epoch = this.endpointEpoch; const version = this.transcriptVersions.get(sessionId) ?? 0; const chat = this.state.chats[sessionId] ?? emptyChat(); const result = await client.request<{rows: unknown[]; next_cursor: string | null; reset?:boolean}>('session.transcript', {session_id:sessionId, order:'latest', cursor:chat.cursor, limit:50}); if (this.endpointEpoch !== epoch || this.client !== client || (this.transcriptVersions.get(sessionId) ?? 0) !== version) return; const current = this.state.chats[sessionId] ?? emptyChat(); const existing = current.messages.map(asObject); const older = result.rows.filter(x => { const row = asObject(x); return !existing.some(e => row.row_id != null && e.row_id != null && e.row_id === row.row_id); }); this.setChat(sessionId, { ...current, messages: result.reset ? result.rows : [...older, ...current.messages], cursor: result.next_cursor }); };
  readImage = async (sessionId: string, path: string, signal?: AbortSignal) => {
    const credentials = this.credentials; if (!credentials) throw new Error('Configure the gateway first');
    const epoch = this.endpointEpoch;
    const key = JSON.stringify([credentials.origin,epoch,sessionId,path]);
    const value = await this.imageReads.read(key, async sharedSignal => {
      const query = 'path='+encodeURIComponent(path)+'&session_id='+encodeURIComponent(sessionId);
      const response = await fetch(credentials.origin+'/api/fs/read-data-url?'+query, {headers:{Authorization:'Bearer '+credentials.token},redirect:'error',signal:sharedSignal});
      this.assertEndpointEpoch(epoch); if (!response.ok) throw new Error('Image could not be loaded');
      const result = await response.json(); this.assertEndpointEpoch(epoch);
      if (typeof result.dataUrl !== 'string' || !result.dataUrl.startsWith('data:image/')) throw new Error('Invalid image response');
      return result.dataUrl as string;
    },signal);
    this.assertEndpointEpoch(epoch); if (signal?.aborted) throw new Error('Image request cancelled'); return value;
  };
  private audioRequest = async (path:'/api/audio/transcribe'|'/api/audio/speak', body:Record<string,unknown>, signal:AbortSignal, epoch:number) => {
    const credentials=this.credentials;this.assertEndpointEpoch(epoch);if(!credentials || signal.aborted)throw new Error('Audio unavailable');
    const controller=new AbortController(), abort=()=>controller.abort();const unlisten=this.subscribe(()=>{if(this.endpointEpoch!==epoch)abort();});
    signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,45000);
    try {
      if(signal.aborted)throw new Error('Audio unavailable');
      const response=await fetch(credentials.origin+path,{method:'POST',headers:{Authorization:'Bearer '+credentials.token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:controller.signal});
      this.assertEndpointEpoch(epoch);if(signal.aborted || controller.signal.aborted || !response.ok)throw new Error('Audio unavailable');
      const result=JSON.parse(await limitedText(response,path==='/api/audio/transcribe'?256*1024:7*1024*1024));
      this.assertEndpointEpoch(epoch);if(signal.aborted || controller.signal.aborted || result?.ok!==true)throw new Error('Audio unavailable');return result;
    } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);unlisten();}
  };
  transcribeAudio = async (dataUrl:string,signal:AbortSignal,epoch:number) => {
    if(!/^data:audio\/mp4;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)||dataUrl.length>Math.ceil(5*1024*1024*4/3)+64)throw new Error('Invalid audio');
    const result=await this.audioRequest('/api/audio/transcribe',{data_url:dataUrl,mime_type:'audio/mp4'},signal,epoch);
    if(typeof result.transcript!=='string'||result.transcript.length>20000)throw new Error('Invalid transcript');return result.transcript as string;
  };
  speakAudio = async (text:string,signal:AbortSignal,epoch:number) => {
    if(!text.trim()||text.length>4000)throw new Error('Invalid speech text');const result=await this.audioRequest('/api/audio/speak',{text},signal,epoch);
    const mime=typeof result.mime_type==='string'?result.mime_type.split(';')[0].trim().toLowerCase():'';
    if(!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/mp4'].includes(mime)||typeof result.data_url!=='string')throw new Error('Invalid audio');
    const match=/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(result.data_url);if(!match||match[1].toLowerCase()!==mime||match[2].length%4||match[2].length>Math.ceil(5*1024*1024*4/3)+4 || (match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0))>5*1024*1024)throw new Error('Invalid audio');
    return {mime,base64:match[2]};
  };
  uploadImage = async (dataUrl:string,filename:string,signal?:AbortSignal) => {
    const credentials=this.credentials;if(!credentials)throw new Error('Configure the gateway first');
    const epoch=this.endpointEpoch,controller=new AbortController(),abort=()=>controller.abort();
    const unsubscribe=this.subscribe(()=>{if(this.endpointEpoch!==epoch)abort();});
    signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
    try{
      if(signal?.aborted)throw new Error('Image upload cancelled');
      const response=await fetch(`${credentials.origin}/api/chat/image-upload`,{method:'POST',headers:{Authorization:`Bearer ${credentials.token}`,'Content-Type':'application/json'},body:JSON.stringify({data_url:dataUrl,filename}),signal:controller.signal,redirect:'error'});
      this.assertEndpointEpoch(epoch);if(!response.ok||controller.signal.aborted)throw new Error('Image upload failed');
      const result=JSON.parse(await limitedText(response,256*1024));this.assertEndpointEpoch(epoch);
      if(controller.signal.aborted||typeof result.path!=='string'||!result.path||result.path.length>8192||!['image/png','image/jpeg','image/gif','image/webp'].includes(result.mime_type))throw new Error('Invalid image upload response');
      return {path:result.path as string,mime:result.mime_type as string};
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);unsubscribe();}
  };
  dispose = () => { this.disposed = true; this.endpointEpoch++; conversationDiagnostics.setEnabled(false);this.diagnosticSubmissions.clear();this.imageReads.clear(); if (this.eventTimer) clearTimeout(this.eventTimer); if (this.cacheTimer) clearTimeout(this.cacheTimer); this.eventTimer = null; this.cacheTimer = null; this.events = []; this.cleanup.splice(0).forEach(fn => fn()); this.secret?.reject(new Error('Manager disposed')); this.secret = null; this.client?.close(); this.client = null; this.listeners.clear(); this.voiceListeners.clear(); };
  private requireClient() { if (!this.client) throw new Error('Configure the gateway first'); return this.client; }
}
export const appManager = new AppManager();
function shallowEqual(a: any, b: any) { return Object.is(a,b) || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.is(a[key],b[key]))); }
export function useAppStore(): AppState;
export function useAppStore<T>(selector: (state: AppState) => T): T;
export function useAppStore<T>(selector?: (state: AppState) => T) {
  const cache = useRef<{value:T | AppState} | null>(null);
  const getSnapshot = useCallback(() => {
    const state = appManager.getState(), value = selector ? selector(state) : state;
    if (cache.current && shallowEqual(cache.current.value,value)) return cache.current.value;
    cache.current = {value}; return value;
  },[selector]);
  return useSyncExternalStore(appManager.subscribe,getSnapshot,getSnapshot);
}
export type { AppState, ChatState, SessionRow } from '../types';
