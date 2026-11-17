import { gatewayOrigin, hermesHome } from './config.mjs';
// Never print credentials or HTTP response bodies. No dependency on app tooling.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const envPath = join(hermesHome(), '.env');
const key = 'HERMES_DASHBOARD_SESSION_TOKEN';
const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const entries = [...env.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
const action = process.argv[2];
if (action === 'provision') {
  if (entries.length) {
    console.log('Session token entry already exists; preserved without displaying it.');
  } else {
    appendFileSync(envPath, `${env.endsWith('\n') || !env ? '' : '\n'}${key}=${randomBytes(32).toString('base64url')}\n`, { mode: 0o600 });
    console.log('Generated 32-byte session token directly into Hermes .env; value hidden.');
  }
} else if (action === 'verify') {
  if (entries.length !== 1) throw new Error('Expected exactly one session token entry.');
  let token = entries[0][1].trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || token.startsWith('file:')) throw new Error('Expected a nonempty literal token.');
  const base = gatewayOrigin();
  const status = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  const body = await status.json();
  console.log(JSON.stringify({ route: '/api/status', status: status.status, auth_required: body.auth_required, auth_providers: body.auth_providers }));
  let passed = status.status === 200 && body.auth_required === true && JSON.stringify(body.auth_providers).includes('session-token');
  for (const authenticated of [false, true]) {
    const response = await fetch(`${base}/api/auth/me`, { headers: authenticated ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000), redirect: 'error' });
    console.log(JSON.stringify({ route: '/api/auth/me', authenticated, status: response.status }));
    passed &&= response.status === (authenticated ? 200 : 401);
    await response.body?.cancel();
  }
  if (!passed) process.exitCode = 1;
} else {
  throw new Error('Usage: node tools/pc-setup.mjs provision|verify');
}
