import { gatewayOrigin, hermesHome } from '../config.mjs';
// Read-only real-gateway catalog check. Never writes credentials or raw RPC replies.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(new URL('../../.artifacts/protocol-runtime/package.json', import.meta.url), '{"type":"module"}\n');
const { CanonicalClient } = await import('../../.artifacts/protocol-runtime/index.js');
const { mobileModelChoices } = await import('../../app/src/components/selections.ts');
const env = readFileSync(join(hermesHome(), '.env'), 'utf8');
const entries = [...env.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
if (entries.length !== 1) throw new Error('Expected exactly one deployment token entry');
let token = entries[0][1].trim();
if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
if (!token || token.startsWith('file:')) throw new Error('Expected a literal deployment token');
const client = new CanonicalClient({baseUrl:gatewayOrigin(), getToken:async()=>token,
  persistSubmission:async()=>{throw new Error('Read-only probe');}, acknowledgeSubmission:async()=>{}});
const shape = result => ({provider:result.provider, model:result.model, providers:(result.providers ?? []).map(p=>({slug:p.slug, model_count:p.models?.length ?? 0, source:p.source, auth_type:p.auth_type, authenticated:p.authenticated, is_user_defined:p.is_user_defined, is_current:p.is_current}))});
try {
  await client.connect();
  const runtime = await client.request('runtime.describe', {});
  const broad = await client.request('model.options', {});
  const configured = await client.request('model.options', {explicit_only:true});
  if (!Array.isArray(configured.providers)) throw new Error('Catalog shape changed');
  const list = await client.request('session.list', {scope:'stored',limit:100,picker:true});
  const row = list.sessions?.find(s=>s.source === 'desktop' && !s.running && s.message_count > 0);
  let scoped;
  if (row) scoped = await client.request('model.options', {session_id:row.session_id || row.id,explicit_only:true});
  const mobile = result => Object.fromEntries([...new Set(mobileModelChoices(result).map(p=>p.provider))].map(slug=>[slug,mobileModelChoices(result).filter(p=>p.provider===slug).length]));
  const evidence = {checked_at:new Date().toISOString(),global:shape(configured),unfiltered:shape(broad),mobile_visible:mobile(configured),mobile_session_visible:scoped ? mobile(scoped) : null,
    session_scoped:scoped ? shape(scoped) : null,create_accepts_provider:runtime.session_create?.parameters?.includes('provider') === true,
    recent_workspaces:new Set((list.sessions ?? []).map(s=>s.cwd).filter(Boolean)).size};
  writeFileSync(new URL('../../.artifacts/model-options-probe.json', import.meta.url),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} catch {
  console.error('Read-only model catalog probe failed; no raw transport diagnostics printed.');
  process.exitCode = 1;
} finally {client.close();}
