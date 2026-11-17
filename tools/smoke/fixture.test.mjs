import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedFixture, archiveOwnedFixture } from './fixture.mjs';

test('fresh fixture titles do not touch a preexisting matching label and cleanup uses only returned IDs', async () => {
  const existing = { id: 'old', title: 'Hermes Mobile reasoning picker protocol check' };
  const titles = [], mutations = [];
  const client = {
    async createSession({ title }) { titles.push(title); return { session_id: `new-${titles.length}` }; },
    async mutate(...args) { mutations.push(args); },
  };
  for (const label of [existing.title, existing.title, 'Hermes Mobile synthetic latency probe', 'Hermes Mobile synthetic latency probe']) {
    const id = await createOwnedFixture(client, label);
    await archiveOwnedFixture(client, id);
  }
  assert.equal(new Set(titles).size, 4);
  assert.ok(titles.every(title => title !== existing.title && / [0-9a-f-]{36}$/.test(title)));
  assert.deepEqual(mutations.map(([id]) => id), ['new-1', 'new-2', 'new-3', 'new-4']);
  assert.ok(mutations.every(([, operation, payload]) => operation === 'archive' && payload.archived === true));
});

test('invalid create response never yields an owned ID', async () => {
  await assert.rejects(createOwnedFixture({ createSession: async () => ({}) }, 'fixture'), /Invalid fixture session/);
});
