import { gatewayOrigin, readDeploymentToken } from '../config.mjs';
// Read-only acceptance check for the compiled protocol package. No app secrets.
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../../.artifacts/protocol-runtime/package.json', import.meta.url), '{"type":"module"}\n');
const { CanonicalClient } = await import('../../.artifacts/protocol-runtime/index.js');

const token = readDeploymentToken();
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
