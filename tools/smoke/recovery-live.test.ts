import { gatewayOrigin, hermesHome } from '../config.mjs';
// Explicit opt-in integration: real gateway, only disposable sessions owned by this test.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CanonicalClient } from '@hermes-mobile/protocol';

it('recovers healthy sessions after another is deleted and reads terminal receipts', async () => {
  const env = readFileSync(join(hermesHome(), '.env'), 'utf8');
  const entries = [...env.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
  if (entries.length !== 1) throw new Error('Local credential configuration unavailable');
  let token = entries[0][1].trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || token.startsWith('file:')) throw new Error('Local credential configuration unavailable');
  const unavailable: Array<{id:string; reason:string; code:number}> = [];
  const client = new CanonicalClient({ baseUrl:gatewayOrigin(), getToken:async () => token, persistSubmission:async () => {}, acknowledgeSubmission:async () => {}, onSessionUnavailable:(id, detail) => unavailable.push({id,...detail}) });
  const cleanup = new CanonicalClient({ baseUrl:gatewayOrigin(), getToken:async () => token, persistSubmission:async () => {}, acknowledgeSubmission:async () => {} });
  const owned = new Set<string>();
  let stage = 'connect';
  try {
    await client.connect();
    const deleted = await client.createSession({title:`Hermes Mobile recovery deleted ${crypto.randomUUID()}`}); owned.add(deleted.session_id);
    const healthy = await client.createSession({title:`Hermes Mobile recovery healthy ${crypto.randomUUID()}`}); owned.add(healthy.session_id);
    await client.openSession(deleted.session_id); await client.openSession(healthy.session_id);
    await client.mutate(deleted.session_id,'delete',{}); owned.delete(deleted.session_id);
    // Retain both in the client's recovery map, as happens with a different viewer's deletion.
    stage = 'reconnect after deletion'; client.close(); await client.connect();
    expect(client.connectionState).toBe('ready');
    expect(unavailable).toEqual([{id:deleted.session_id, reason:'not_found', code:4001}]);
    expect(client.getSession(deleted.session_id)).toBeUndefined();
    expect((await client.openSession(healthy.session_id)).session_id).toBe(healthy.session_id);
    stage = 'submit healthy'; const admission = await client.submit({session_id:healthy.session_id,text:'Without using any tools, reply exactly RECOVERY_CHECK_OK.'}) as {admission_id?:string};
    expect(typeof admission.admission_id).toBe('string');
    stage = 'receipt'; let terminal = false;
    const end = Date.now()+90_000;
    while (Date.now()<end) {
      const receipt = await client.request<{status:string}>('prompt.receipt',{session_id:healthy.session_id,admission_id:admission.admission_id!,include_result:true});
      if (receipt.status==='terminal') { terminal=true; break; }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    expect(terminal).toBe(true);
    writeFileSync('.artifacts/recovery-live-result.json', JSON.stringify({checked_at:new Date().toISOString(),passed:true,transport:'real Tailscale HTTPS/WSS',checks:['deleted session reports structured 4001 not_found once','reconnect reaches ready with healthy session retained','healthy session accepts a prompt after reconnect','prompt.receipt reaches terminal without resubmission'],native_test:false},null,2));
  } catch (error) {
    const e = error as {code?:number;data?:{reason?:string}};
    throw new Error(`Recovery check failed at ${stage}; code=${e.code}; reason=${e.data?.reason}`);
  } finally {
    client.close();
    try { await cleanup.connect(); for (const id of owned) { await cleanup.openSession(id); await cleanup.mutate(id,'archive',{archived:true}); } }
    finally { cleanup.close(); }
  }
});
