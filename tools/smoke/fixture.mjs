import { randomUUID } from 'node:crypto';

// A fresh, unguessable title avoids resolving a create to an existing titled session.
export async function createOwnedFixture(client, label) {
  const created = await client.createSession({ title: `${label} ${randomUUID()}` });
  if (typeof created?.session_id !== 'string' || !created.session_id) throw new Error('Invalid fixture session');
  return created.session_id;
}
export async function archiveOwnedFixture(client, sessionId) {
  await client.mutate(sessionId, 'archive', { archived: true });
}
