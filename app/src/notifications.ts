import notifee, { AndroidForegroundServiceType, AndroidImportance, AndroidStyle, AndroidVisibility, EventType, type Event } from '@notifee/react-native';
import { AppState, Linking } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { appManager } from './state';
import { eventKey, safeChoices, sessionFromUrl, sessionUrl } from './notificationCore';
import { getMonitorMode, subscribeMonitorMode } from './preferences';
import { notificationText, notificationLiteral } from './notificationText';
import { monitorStatus } from './components/monitorStatus';

const db = SQLite.openDatabaseSync('hermes-notifications.db');
db.execSync('CREATE TABLE IF NOT EXISTS seen (key TEXT PRIMARY KEY NOT NULL, created INTEGER NOT NULL)');
const channel = 'hermes-events';
const serviceChannel = 'hermes-monitor';
const idFor = (origin:string, session:string, prompt:string) => `prompt:${encodeURIComponent(JSON.stringify([origin,session,prompt]))}`;
let runnerResolve: (() => void) | null = null;
let lastStatus = '';
let started = false, starting = false, idle: ReturnType<typeof setTimeout> | null = null;
let serviceTail = Promise.resolve();
let notificationTail = Promise.resolve();
let monitorWatchInstalled = false, monitorFailed = false;
const monitorListeners = new Set<() => void>();
function emitMonitorStatus() { for (const listener of monitorListeners) listener(); }
export function getMonitorStatus() {
  return monitorStatus({mode:getMonitorMode(),started,starting,idle:!!idle,configured:appManager.getState().credentialsConfigured,active:AppState.currentState === 'active',failed:monitorFailed});
}
export function subscribeMonitorStatus(listener: () => void) {
  monitorListeners.add(listener);
  const unstate = appManager.subscribe(listener), unmode = subscribeMonitorMode(listener), appState = AppState.addEventListener('change', listener);
  return () => { monitorListeners.delete(listener); unstate(); unmode(); appState.remove(); };
}
function installMonitorWatch() {
  if (monitorWatchInstalled) return; monitorWatchInstalled = true;
  appManager.subscribe(reconcileService); subscribeMonitorMode(reconcileService); AppState.addEventListener('change', reconcileService);
}
function enqueue(work: () => Promise<void>) { notificationTail = notificationTail.catch(() => {}).then(work); return notificationTail; }
async function channels() {
  await notifee.createChannel({id:channel,name:'Hermes updates',importance:AndroidImportance.DEFAULT});
  await notifee.createChannel({id:serviceChannel,name:'Connection monitor',importance:AndroidImportance.LOW});
}
function visibleSession(session:string) { return AppState.currentState === 'active' && appManager.getState().activeSessionId === session; }
function remember(key:string) {
  db.runSync('INSERT OR IGNORE INTO seen (key, created) VALUES (?, ?)', key, Date.now());
  db.runSync('DELETE FROM seen WHERE created < ?', Date.now() - 30*86400000);
  db.runSync('DELETE FROM seen WHERE rowid IN (SELECT rowid FROM seen ORDER BY created DESC, rowid DESC LIMIT -1 OFFSET 4096)');
}
function stopService() {
  if (idle) clearTimeout(idle); idle = null; emitMonitorStatus();
  serviceTail = serviceTail.catch(() => {}).then(async () => { if (!started && !starting) return; await notifee.stopForegroundService(); started = false; starting = false; emitMonitorStatus(); runnerResolve?.(); runnerResolve = null; if (getMonitorMode() !== 'off' && AppState.currentState === 'active') reconcileService(); }).catch(() => {});
}
function reconcileService() {
  const mode = getMonitorMode(), state = appManager.getState();
  const busy = Object.values(state.chats).some(c => c.running || c.prompts.length > 0);
  if (started && state.connection !== lastStatus) {
    lastStatus = state.connection;
    serviceTail = serviceTail.catch(() => {}).then(async () => {
      if (!started || getMonitorMode() === 'off') return;
      await notifee.displayNotification({id:'hermes-monitor',title:'Hermes connection monitor',body:`Connection: ${appManager.getState().connection}`,android:{channelId:serviceChannel,asForegroundService:true,foregroundServiceTypes:[AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING],ongoing:true,onlyAlertOnce:true,pressAction:{id:'default'}}});
    }).catch(() => { lastStatus = ''; });
  }
  if (mode === 'off') return stopService();
  if (mode === 'whileturnruns' && !busy) {
    if (started && !idle) { idle = setTimeout(stopService, 3 * 60 * 1000); emitMonitorStatus(); }
    return;
  }
  if (idle) { clearTimeout(idle); idle = null; emitMonitorStatus(); }
  if (AppState.currentState !== 'active' || started || starting || !state.credentialsConfigured) return;
  starting = true; monitorFailed = false; emitMonitorStatus();
  serviceTail = serviceTail.catch(() => {}).then(async () => {
    if (AppState.currentState !== 'active' || getMonitorMode() === 'off') { starting = false; emitMonitorStatus(); return; }
    await channels();
    const current = appManager.getState();
    if (AppState.currentState !== 'active' || getMonitorMode() === 'off' || (getMonitorMode() === 'whileturnruns' && !Object.values(current.chats).some(c => c.running || c.prompts.length))) { starting = false; emitMonitorStatus(); return; }
    await notifee.displayNotification({id:'hermes-monitor',title:'Hermes connection monitor',body:`Connection: ${appManager.getState().connection}`,android:{channelId:serviceChannel,asForegroundService:true,foregroundServiceTypes:[AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING],ongoing:true,pressAction:{id:'default'}}});
    started = true; starting = false; lastStatus = current.connection; emitMonitorStatus();
  }).catch(() => { starting = false; monitorFailed = true; emitMonitorStatus(); });
}
export function registerNotifications() {
  notifee.registerForegroundService(() => new Promise<void>(resolve => { runnerResolve = resolve; started = true; emitMonitorStatus(); installMonitorWatch(); void appManager.initialize().then(reconcileService).catch(() => {}); }));
  notifee.onBackgroundEvent(async event => { try { await handleEvent(event); } catch {} });
}
export function setupNotifications() {
  const unlisten = notifee.onForegroundEvent(event => { void handleEvent(event).catch(() => {}); });
  installMonitorWatch();
  const link = Linking.addEventListener('url', ({url}) => { void route(url).catch(() => {}); });
  void Linking.getInitialURL().then(url => url ? route(url) : undefined).catch(() => {});
  void notifee.getInitialNotification().then(initial => initial?.notification.data ? routeNotification(initial.notification.data) : undefined).catch(() => {});
  reconcileService();
  return () => { unlisten(); link.remove(); };
}
async function route(url:string) { const session = sessionFromUrl(url); if (!session) return; await appManager.initialize(); if (appManager.getState().credentialsConfigured) await appManager.openSession(session); }
async function routeNotification(data: Record<string, unknown>) { await appManager.initialize(); if (typeof data.url === 'string' && data.origin === appManager.getConfiguredOrigin()) await route(data.url); }
async function handleEvent(event: Event) {
  const data = event.detail.notification?.data;
  if (event.type === EventType.PRESS && data) { await routeNotification(data); return; }
  const choice = event.detail.pressAction?.id;
  if (event.type !== EventType.ACTION_PRESS || !data || (choice !== 'once' && choice !== 'deny')) return;
  try { await appManager.respondNotificationApproval(data, choice); if (event.detail.notification?.id) await notifee.cancelNotification(event.detail.notification.id); }
  catch { await channels(); await notifee.displayNotification({title:'Could not respond to approval',body:'Open Hermes Mobile to check the request.',android:{channelId:channel,pressAction:{id:'default'}}}); }
}
const notificationTypes = new Set(['approval.request','approval.settled','approval.cancelled','clarify.request','clarify.settled','message.complete']);
export function notifyEvent(origin:string, event:any) { if (!notificationTypes.has(event?.type)) return Promise.resolve(); return enqueue(() => notifyEventNow(origin,event)); }
async function notifyEventNow(origin:string, event:any) {
  if (appManager.getConfiguredOrigin() !== origin) return;
  const session = event.session_id, p = event.payload ?? {};
  if (!session || typeof session !== 'string') return;
  if (['approval.settled','approval.cancelled','clarify.settled'].includes(event.type) && typeof p.prompt_id === 'string') { await notifee.cancelNotification(idFor(origin,session,p.prompt_id)); return; }
  if (!['message.complete','approval.request','clarify.request'].includes(event.type)) return;
  const key = (event.type === 'approval.request' || event.type === 'clarify.request') && typeof p.prompt_id === 'string' && Number.isSafeInteger(event.execution_generation) ? JSON.stringify([origin,session,p.prompt_id,event.execution_generation,event.type]) : eventKey(origin,event); if (!key) return;
  if (db.getFirstSync('SELECT key FROM seen WHERE key = ?', key)) return;
  if (visibleSession(session)) { remember(key); return; }
  await channels();
  if (appManager.getConfiguredOrigin() !== origin) return;
  if (visibleSession(session)) { remember(key); return; }
  const prompt = typeof p.prompt_id === 'string' ? p.prompt_id : '';
  const approval = event.type === 'approval.request';
  const actions = approval && prompt && Number.isSafeInteger(event.execution_generation) ? safeChoices(p.choices).map(choice => ({title:choice === 'once' ? 'Allow once' : 'Deny',pressAction:{id:choice}})) : [];
  const state = appManager.getState();
  const info = state.chats[session]?.snapshot?.info;
  const title = state.sessions.find(row => row.id === session)?.title || (info && typeof info === 'object' && 'title' in info ? info.title : undefined);
  const copy = notificationText(event.type, p, title);
  await notifee.displayNotification({
    id:prompt ? idFor(origin,session,prompt) : `turn:${encodeURIComponent(JSON.stringify([origin,session]))}`,
    title:notificationLiteral(copy.title), body:notificationLiteral(copy.body),
    data:{url:sessionUrl(session),origin,session,prompt,generation:String(event.execution_generation ?? '')},
    android:{channelId:channel,pressAction:{id:'default'},actions,visibility:AndroidVisibility.PRIVATE,
      style:{type:AndroidStyle.BIGTEXT,text:notificationLiteral(copy.expanded)}},
  });
  remember(key);
}
export async function requestNotificationPermission() { return notifee.requestPermission(); }
export async function getNotificationPermission() { return notifee.getNotificationSettings(); }
export async function openNotificationSettings() { return notifee.openNotificationSettings(); }

export function reconcileSnapshot(origin:string, session:string, snapshot:any) { return enqueue(() => reconcileSnapshotNow(origin,session,snapshot)); }
async function reconcileSnapshotNow(origin:string, session:string, snapshot:any) {
  if (appManager.getConfiguredOrigin() !== origin) return;
  const active = new Set((Array.isArray(snapshot.prompts) ? snapshot.prompts : []).map((p:any) => p?.prompt_id).filter((id:any) => typeof id === 'string'));
  for (const p of Array.isArray(snapshot.prompts) ? snapshot.prompts : []) {
    if (!p || typeof p.prompt_id !== 'string') continue;
    const type = p.question || String(p.kind ?? p.type ?? '').includes('clarify') ? 'clarify.request' : 'approval.request';
    await notifyEventNow(origin,{type,session_id:session,execution_generation:p.execution_generation ?? snapshot.execution_generation,payload:p});
  }
  const shown = await notifee.getDisplayedNotifications();
  if (appManager.getConfiguredOrigin() !== origin) return;
  for (const entry of shown) {
    const data = entry.notification?.data;
    if (data?.origin === origin && data.session === session && typeof data.prompt === 'string' && data.prompt && !active.has(data.prompt) && entry.notification?.id) await notifee.cancelNotification(entry.notification.id);
  }
}
