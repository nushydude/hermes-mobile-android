import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Do not include the supplied value in errors: it may contain credentials.
export function httpsOrigin(value, name) {
  if (typeof value !== 'string' || !/^https:\/\/[^\s/?#]+\/?$/i.test(value)) throw new Error(`${name} must be an HTTPS origin`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin`); }
  if (url.protocol !== 'https:' || !url.hostname || (value.includes('@') || value.includes('\\')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(`${name} must be an HTTPS origin`);
  return url.origin;
}
export const gatewayOrigin = () => httpsOrigin(process.env.HERMES_MOBILE_GATEWAY_URL, 'HERMES_MOBILE_GATEWAY_URL');
export const ntfyOrigin = () => httpsOrigin(process.env.HERMES_MOBILE_NTFY_URL, 'HERMES_MOBILE_NTFY_URL');
export const hermesHome = () => process.env.HERMES_HOME || (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'hermes') : join(homedir(), '.hermes'));

// Compare using HTTPS URL normalization (host case and the default port).
export function subscriptionUrl(value, origin) {
  const invalid = () => new Error('Invalid private subscription configuration');
  if (typeof value !== 'string' || !/^ntfy:\/\/[^\s/?#@\\]+\/hm_[a-f0-9]{32}$/.test(value)) throw invalid();
  try {
    const url = new URL(value);
    const subscriptionOrigin = new URL('https://' + url.host).origin;
    if (url.protocol !== 'ntfy:' || url.username || url.password || url.search || url.hash || subscriptionOrigin !== httpsOrigin(origin, 'HERMES_MOBILE_NTFY_URL')) throw invalid();
    return url.toString();
  } catch { throw invalid(); }
}

// Parse only literal deployment-token assignments; never include their values in errors.
export function tokenEntries(text) {
  return [...text.matchAll(/^[^\S\r\n]*(?:export[^\S\r\n]+)?HERMES_DASHBOARD_SESSION_TOKEN[^\S\r\n]*=[^\S\r\n]*(.*)$/gm)].map(match => match[1]);
}
export function parseDeploymentToken(text) {
  const entries = tokenEntries(text);
  if (entries.length !== 1) throw new Error('Credential configuration unavailable');
  let token = entries[0].trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || token.startsWith('file:')) throw new Error('Credential configuration unavailable');
  return token;
}
export function readDeploymentToken() {
  try { return parseDeploymentToken(readFileSync(join(hermesHome(), '.env'), 'utf8')); }
  catch { throw new Error('Credential configuration unavailable'); }
}
