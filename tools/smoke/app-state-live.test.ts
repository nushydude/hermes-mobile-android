import { gatewayOrigin, hermesHome } from '../config.mjs';
// Explicit live integration check. Native adapters are memory mocks; transport is real.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
vi.mock('../../app/src/notifications', () => ({notifyEvent:async()=>{},reconcileSnapshot:async()=>{}}));

const local = vi.hoisted(() => ({ secure: new Map<string, string>(), saved: '' }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: () => () => {} } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => local.secure.get(key) ?? null, setItemAsync: async (key: string, value: string) => { local.secure.set(key, value); } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({ execAsync: async () => {}, getFirstAsync: async () => local.saved ? { value: local.saved } : null, runAsync: async (_sql: string, _key: string, value: string) => { local.saved = value; } }) }));
import { AppManager } from '../../app/src/state/index';
import { CanonicalClient } from '@hermes-mobile/protocol';
const manager = new AppManager();
let ownedSession: string | null = null;
const until = async (predicate: () => boolean, ms = 90_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Live app state condition timed out');
};
afterAll(async () => {
  try { if (ownedSession && manager.getState().connection === 'ready') await manager.mutate(ownedSession, 'archive', {archived:true}); }
  finally { manager.dispose(); }
});

it('real gateway accepts app outbox and populates authoritative shared history', async () => {
  const env = readFileSync(join(hermesHome(), '.env'), 'utf8');
  const entries = [...env.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
  if (entries.length !== 1) throw new Error('Local credential configuration unavailable');
  let token = entries[0][1].trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || token.startsWith('file:')) throw new Error('Local credential configuration unavailable');
  try { await manager.configure({ baseUrl: gatewayOrigin(), token }); }
  catch { throw new Error('Live gateway configuration failed (credentials redacted)'); }
  expect(manager.getState().connection).toBe('ready');
  await manager.refreshSessions();
  expect(manager.getState().sessions.length).toBeGreaterThan(0);
  const inventory = { rows: manager.getState().sessions.length, at_gateway_limit: manager.getState().historyTruncated };
  const sessionId = await manager.createSession({ title: `Hermes Mobile app state ${crypto.randomUUID()}` });
  ownedSession = sessionId;
  writeFileSync('.artifacts/app-state-live-current.json', JSON.stringify({session_id:sessionId,created_at:new Date().toISOString()}));
  const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
  const uploaded = await manager.uploadImage(imageData, 'app-state-fixture.png');
  expect(uploaded.mime).toBe('image/png');
  expect(await manager.readImage(sessionId, uploaded.path)).toBe(imageData);
  const marker = `APP_STATE_${crypto.randomUUID().replaceAll('-', '')}`;
  await manager.send(sessionId, `Without using any tools, reply exactly ${marker}.`);
  expect(manager.getState().chats[sessionId].localMessages.some(message => message.text.includes(marker))).toBe(true);
  await until(() => manager.getState().outbox.length === 0);
  await until(() => {
    const chat = manager.getState().chats[sessionId];
    return !!chat && !chat.running && chat.messages.some(message => {
      const row = message as Record<string, unknown>;
      return row.role === 'assistant' && String(row.text ?? row.content ?? '').includes(marker);
    }) && chat.messages.some(message => {
      const row = message as Record<string, unknown>;
      return row.role === 'user' && String(row.text ?? row.content ?? '').includes(marker);
    });
  });
  const chat = manager.getState().chats[sessionId];
  expect(chat.messages.some(message => String((message as Record<string, unknown>).text ?? (message as Record<string, unknown>).content ?? '').includes('Without using any tools'))).toBe(true);
  expect(chat.liveText).toBe('');
  await until(() => manager.getState().chats[sessionId].localMessages.length === 0);
  expect(manager.getState().chats[sessionId].messages.filter(message => {
    const row = message as Record<string, unknown>;
    return row.role === 'user' && String(row.text ?? row.content ?? '').includes(marker);
  })).toHaveLength(1);
  expect(local.saved.includes(token)).toBe(false);
  // A second viewer exercises inbound handoff through the real shared authority.
  // This is transport integration, not a claim about the actual Desktop or phone UI.
  const other = new CanonicalClient({ baseUrl: gatewayOrigin(), getToken: async () => token, persistSubmission: async () => {}, acknowledgeSubmission: async () => {} });
  const remoteMarker = `OTHER_VIEWER_${crypto.randomUUID().replaceAll('-', '')}`;
  let remotePendingSeen = false;
  const unsubscribe = manager.subscribe(() => {
    const current = manager.getState().chats[sessionId];
    if (current?.pending.some(prompt => String((prompt as Record<string, unknown>).text ?? '').includes(remoteMarker))) remotePendingSeen = true;
  });
  try {
    await other.connect(); await other.openSession(sessionId);
    await other.submit({ session_id: sessionId, text: `Without using tools, reply exactly ${remoteMarker}.` });
    await until(() => manager.getState().chats[sessionId].messages.some(message => {
      const row = message as Record<string, unknown>;
      return row.role === 'assistant' && String(row.text ?? row.content ?? '').includes(remoteMarker);
    }));
    expect(remotePendingSeen).toBe(true);
  } finally { unsubscribe(); other.close(); }
  await manager.mutate(sessionId, 'archive', { archived: true });
  ownedSession = null;
  writeFileSync('.artifacts/app-state-live-result.json', JSON.stringify({ checked_at: new Date().toISOString(), passed: true, native_adapters: 'in-memory mocks', transport: 'real Tailscale HTTPS/WSS gateway', inventory, checks: ['authentication and canonical authority', 'inventory', 'own GUI session creation', 'image upload and exact readback', 'optimistic prompt visible before receipt', 'durable outbox receipt', 'authoritative user and assistant transcript', 'optimistic prompt retired without duplicate', 'other viewer pending prompt and reply without refresh', 'own test session archived'] }, null, 2));
});
