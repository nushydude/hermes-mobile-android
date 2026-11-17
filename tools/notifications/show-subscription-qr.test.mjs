import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('subscription QR refuses piped output before reading private configuration', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hermes-qr-test-'));
  try {
    const result = spawnSync(process.execPath, [resolve('tools/notifications/show-subscription-qr.mjs')], {
      cwd, encoding: 'utf8', env: { ...process.env, HERMES_MOBILE_NTFY_URL: 'https://user:secret@example.test' },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /interactive local terminal/);
    assert.doesNotMatch(result.stderr, /secret|subscription\.json|ENOENT/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
