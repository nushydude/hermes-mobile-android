import { hermesHome } from './config.mjs';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.HERMES_SOURCE || join(hermesHome(), 'hermes-agent');
const source = join(home, 'apps', 'shared', 'src');
const target = join(root, 'packages', 'hermes-protocol', 'src', 'vendor');
const names = ['gateway-contract.generated.ts', 'gateway-events.ts', 'gateway-canonical.ts', 'gateway-text.ts', 'reconnect-backoff.ts', 'json-rpc-channel.ts', 'json-rpc-gateway.ts'];
const check = process.argv.includes('--check');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = {};
let different = false;
await mkdir(target, { recursive: true });
for (const name of names) {
  const bytes = await readFile(join(source, name));
  hashes[name] = hash(bytes);
  if (check) {
    const existing = await readFile(join(target, name)).catch(() => null);
    if (!existing || !existing.equals(bytes)) { console.error(`Vendor drift: ${name}`); different = true; }
  } else await copyFile(join(source, name), join(target, name));
}
const license = await readFile(join(home, 'LICENSE'));
hashes.LICENSE = hash(license);
const licensePath = join(root, 'packages', 'hermes-protocol', 'LICENSE.hermes');
if (check) {
  const existing = await readFile(licensePath).catch(() => null);
  if (!existing || !existing.equals(license)) { console.error('Vendor drift: LICENSE'); different = true; }
} else {
  await writeFile(licensePath, license);
  await writeFile(join(target, 'provenance.json'), JSON.stringify({ source: 'Hermes Agent apps/shared/src', sha256: hashes }, null, 2) + '\n');
}
if (different) process.exitCode = 1;
else console.log(check ? 'Hermes vendor files match the checkout.' : 'Copied Hermes shared files and license; run the protocol typecheck and tests.');
