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
const until = async (predicate: () => boolean, ms = 90_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Live app state condition timed out');
};
afterAll(() => manager.dispose());

it('renames an own session and returns the committed title in inventory', async () => {
  const env = readFileSync(join(hermesHome(), '.env'), 'utf8');
  const entries = [...env.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
  if (entries.length !== 1) throw new Error('Local credential configuration unavailable');
  let token = entries[0][1].trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || token.startsWith('file:')) throw new Error('Local credential configuration unavailable');
  try { await manager.configure({ baseUrl: gatewayOrigin(), token }); }
  catch { throw new Error('Live gateway configuration failed (credentials redacted)'); }

  const firstTitle = `Hermes Mobile rename check ${crypto.randomUUID()}`;
  const renamedTitle = `Hermes Mobile renamed ${crypto.randomUUID()}`;
  const sid = await manager.createSession({title:firstTitle});
  try {
    await manager.mutate(sid, 'rename', {title:renamedTitle});
    expect(manager.getState().sessions.find(row => row.id === sid)?.title).toBe(renamedTitle);
    const lookup = await manager.findByTitle(renamedTitle);
    expect(lookup.some(row => row.id === sid)).toBe(true);
    writeFileSync('.artifacts/rename-live-result.json', JSON.stringify({checked_at:new Date().toISOString(), session_id:sid, title:renamedTitle, renamed:true, inventory_updated:true, exact_title_lookup:true, retained_for_phone_test:process.env.HERMES_MOBILE_KEEP_RENAME_TEST === '1'},null,2));
  } finally { if (process.env.HERMES_MOBILE_KEEP_RENAME_TEST !== '1') await manager.mutate(sid, 'archive', {archived:true}); }
});
