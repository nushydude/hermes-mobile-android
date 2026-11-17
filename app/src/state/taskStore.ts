import * as SQLite from 'expo-sqlite';
import { appManager } from './index';
import { projectTaskEvent, projectTaskInterrupt, projectTaskRoster, type TaskProjection } from './taskProjection';

let db: SQLite.SQLiteDatabase | null = null;
try {
  const cache = SQLite.openDatabaseSync('hermes-tasks.db');
  try { cache.execSync('CREATE TABLE IF NOT EXISTS task_cache (origin TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)'); }
  catch (error) { try { cache.closeSync(); } catch {} throw error; }
  db = cache;
} catch { /* Task observations remain available in memory. */ }
const empty: TaskProjection[] = [];
let origin = '', sessions: Record<string, TaskProjection[]> = Object.create(null);
const refreshes = new Map<string, object>();
let writeTail: Promise<unknown> = Promise.resolve(), timer: ReturnType<typeof setTimeout> | null = null, pendingWrite: (() => void) | null = null;
let loading: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
function emit() { for (const listener of listeners) listener(); }
function switchOrigin(next: string) {
  if (origin === next) return;
  if (timer) { clearTimeout(timer); timer = null; pendingWrite?.(); pendingWrite = null; }
  origin = next; refreshes.clear(); sessions = Object.create(null); emit();
  if (!origin || !db) { loading = Promise.resolve(); return; }
  const cache = db;
  const target = origin, targetSessions = sessions;
  loading = writeTail.then(() => cache.getFirstAsync<{value:string}>('SELECT value FROM task_cache WHERE origin = ?', target)).then(row => {
    const saved = row ? JSON.parse(row.value) : null;
    if (saved?.origin !== target || !Array.isArray(saved.sessions)) return;
    const touched = Object.keys(targetSessions);
    for (const entry of saved.sessions.slice(-20)) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[0].length > 512 || !Array.isArray(entry[1])) continue;
      const rows = entry[1].slice(-50).filter((x: any) => x && typeof x.id === 'string' && x.id.length <= 512 && typeof x.goal === 'string' && ['running','cancel_requested','unknown','complete','failed','interrupted'].includes(x.status)).map((x: any) => ({id:x.id, goal:x.goal.slice(0,2000), status:x.status === 'running' || x.status === 'cancel_requested' ? 'unknown' : x.status, childSessionId:typeof x.childSessionId === 'string' ? x.childSessionId.slice(0,2000) : null, summary:typeof x.summary === 'string' ? x.summary.slice(0,2000) : null}));
      const current = targetSessions[entry[0]] ?? [];
      const currentIds = new Set(current.map(task => task.id));
      const merged = current.map(task => {
        const savedTask = rows.find((old:TaskProjection) => old.id === task.id);
        return savedTask && ['complete','failed','interrupted'].includes(savedTask.status) ? savedTask : task;
      });
      targetSessions[entry[0]] = [...rows.filter((task:TaskProjection) => !currentIds.has(task.id)), ...merged].slice(-50);
    }
    for (const key of touched) { const value = targetSessions[key]; delete targetSessions[key]; targetSessions[key] = value; }
    for (const key of Object.keys(targetSessions).slice(0,-20)) delete targetSessions[key];
    if (sessions === targetSessions) emit();
  }).catch(() => { /* Cache failure must not affect chat. */ });
}
function save(session: string, tasks: TaskProjection[], terminal = false) {
  if (!origin || !session || session.length > 512) return;
  delete sessions[session]; sessions[session] = tasks.slice(-50);
  for (const key of Object.keys(sessions).slice(0,-20)) delete sessions[key];
  refreshes.delete(session);
  if (!db) { emit(); return; }
  if (timer) clearTimeout(timer);
  const target = origin, targetSessions = sessions, restore = loading, cache = db;
  pendingWrite = () => { writeTail = writeTail.catch(() => {}).then(async () => { await restore; await cache.runAsync('INSERT OR REPLACE INTO task_cache (origin, value) VALUES (?, ?)', target, JSON.stringify({origin:target, sessions:Object.entries(targetSessions)})); }).catch(() => {}); };
  timer = setTimeout(() => { timer = null; pendingWrite?.(); pendingWrite = null; }, terminal ? 0 : 500);
  emit();
}
appManager.subscribeVoiceEvents(event => {
  if (!event.session_id || !event.type.startsWith('subagent.')) return;
  switchOrigin(appManager.getConfiguredOrigin());
  if (!origin) return;
  const previous = sessions[event.session_id] ?? empty;
  const next = projectTaskEvent(previous, event.type, event.payload);
  if (next !== previous) save(event.session_id, next, event.type === 'subagent.complete');
});
export const taskStore = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  activate: (scopeOrigin: string) => { if (appManager.getConfiguredOrigin() === scopeOrigin) switchOrigin(scopeOrigin); },
  get: (scopeOrigin: string, session: string) => origin === scopeOrigin ? sessions[session] ?? empty : empty,
  refresh: async (scopeOrigin: string, session: string, epoch: number) => {
    if (appManager.getEndpointEpoch() !== epoch || appManager.getConfiguredOrigin() !== scopeOrigin || appManager.getState().activeSessionId !== session) return;
    switchOrigin(scopeOrigin); const flight = {}; refreshes.set(session, flight);
    try {
      const result = await appManager.request<{subagents:unknown}>('subagent.list', {session_id:session});
      if (appManager.getEndpointEpoch() !== epoch || appManager.getConfiguredOrigin() !== scopeOrigin || appManager.getState().activeSessionId !== session || refreshes.get(session) !== flight) return;
      if (!Array.isArray(result?.subagents)) throw new Error('Invalid task list');
      save(session, projectTaskRoster(sessions[session] ?? empty, result.subagents));
    } finally { if (refreshes.get(session) === flight) refreshes.delete(session); }
  },
  interrupt: async (scopeOrigin: string, session: string, child: string, epoch: number) => {
    if (appManager.getEndpointEpoch() !== epoch || appManager.getConfiguredOrigin() !== scopeOrigin || appManager.getState().activeSessionId !== session) throw new Error('Conversation changed');
    if (!(sessions[session] ?? empty).some(task => task.id === child && task.status === 'running')) throw new Error('Task is no longer running');
    const result = await appManager.request<{found:boolean}>('subagent.interrupt', {session_id:session, subagent_id:child});
    if (appManager.getEndpointEpoch() !== epoch || appManager.getConfiguredOrigin() !== scopeOrigin || appManager.getState().activeSessionId !== session) return;
    if (result?.found !== true) throw new Error('Task was not found. Refresh to check its status.');
    save(session, projectTaskInterrupt(sessions[session] ?? empty, child, true));
  },
};
