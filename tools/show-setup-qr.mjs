import { gatewayOrigin, hermesHome } from './config.mjs';
// Launch in an owner-visible terminal only. Never capture this program's output.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import qrcode from 'qrcode-terminal';

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error('Setup QR must run in an interactive local terminal.');
  process.exit(1);
}
try {
  const env = readFileSync(join(hermesHome(), '.env'), 'utf8');
  const entries = [...env.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
  if (entries.length !== 1) throw new Error();
  let token = entries[0][1].trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || token.startsWith('file:')) throw new Error();
  console.clear();
  console.log('Hermes Mobile — scan from the app. This code contains your private credential.');
  qrcode.generate(JSON.stringify({ version: 1, baseUrl: gatewayOrigin(), token }), { small: true });
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const timer = setTimeout(() => { console.clear(); input.close(); process.exit(0); }, 120_000);
  await input.question('Press Enter after scanning to clear the code (automatically clears in 2 minutes).');
  clearTimeout(timer); console.clear(); input.close();
} catch {
  console.clear(); console.error('Could not display setup code. Check local Hermes credential configuration.');
  process.exitCode = 1;
}
