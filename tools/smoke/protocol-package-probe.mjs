import { gatewayOrigin, hermesHome } from '../config.mjs';
// Read-only acceptance check for the compiled protocol package. No app secrets.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(new URL('../../.artifacts/protocol-runtime/package.json', import.meta.url), '{"type":"module"}\n');
const { CanonicalClient } = await import('../../.artifacts/protocol-runtime/index.js');

const env = readFileSync(join(hermesHome(), '.env'), 'utf8');
const entries = [...env.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
if (entries.length !== 1) throw new Error('Expected exactly one deployment token entry');
let token = entries[0][1].trim();
if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
if (!token || token.startsWith('file:')) throw new Error('Expected a literal deployment token');
const client = new CanonicalClient({
  baseUrl: gatewayOrigin(),
  getToken: async () => token,
  persistSubmission: async () => { throw new Error('Read-only probe refuses submission'); },
  acknowledgeSubmission: async () => {},
});
try {
  await client.connect();
  const stored = await client.request('session.list', { scope: 'stored', limit: 100, picker: true });
  if (!Array.isArray(stored.sessions)) throw new Error('Inventory shape differs');
  const old = stored.sessions.find(row => row.source === 'desktop' && !row.running && row.message_count > 0);
  if (!old) throw new Error('No idle nonempty desktop session found');
  const snapshot = await client.openSession(old.session_id || old.id);
  await client.detachSession(snapshot.session_id);
  console.log(JSON.stringify({ ready: client.connectionState === 'ready', stored_rows: stored.sessions.length, resumed_messages: snapshot.message_count }));
} catch {
  // Never echo a transport URL, bearer, ticket, or server-supplied error text.
  console.error('Protocol package live read-only probe failed; inspect with sanitized diagnostics.');
  process.exitCode = 1;
} finally { client.close(); }
