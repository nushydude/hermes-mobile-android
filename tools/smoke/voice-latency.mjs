import { gatewayOrigin, hermesHome } from '../config.mjs';
// Bounded synthetic timings only. Never prints credentials, chat content or raw errors.
import { readFileSync, mkdirSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { boundedBytes, metadata, compareMetadata } from './audio-core.mjs';

const origin = gatewayOrigin();
const directory = '.artifacts/handsfree-20261117';
mkdirSync(directory, { recursive: true });
const evidence = { started_at: new Date().toISOString(), result: 'incomplete', timings_ms: {}, cleanup: 'not_needed' };
let stage = 'credentials', session, client;
const now = () => performance.now();
const record = (name, start) => { evidence.timings_ms[name] = Math.round(now() - start); };
const save = () => writeFileSync(join(directory, 'latency.json'), JSON.stringify(evidence, null, 2));
function persistSubmission(submission) {
  const fd = openSync(join(directory, 'latency-submission.json'), 'w', 0o600);
  try { writeSync(fd, JSON.stringify(submission)); fsyncSync(fd); } finally { closeSync(fd); }
}
async function timed(name, operation) { stage = name; const start = now(); try { return await operation(); } finally { record(name, start); save(); } }
async function audio(path, body, token) {
  const response = await fetch(`${origin}/api/audio/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Audio status'); }
  const result = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 7 * 1024 * 1024)));
  if (result.ok !== true) throw new Error('Audio shape');
  return result;
}
try {
  const env = readFileSync(join(hermesHome(), '.env'), 'utf8');
  const entries = [...env.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
  if (entries.length !== 1) throw new Error('Credential');
  let token = entries[0][1].trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || token.startsWith('file:')) throw new Error('Credential');
  const fixture = readFileSync('.artifacts/audio-smoke/fixture.wav');
  const stt = await timed('transcription', () => audio('transcribe', { data_url: `data:audio/wav;base64,${fixture.toString('base64')}`, mime_type: 'audio/wav' }, token));
  evidence.transcript_characters = typeof stt.transcript === 'string' ? stt.transcript.length : 0;
  const { CanonicalClient } = await import('../../.artifacts/protocol-runtime/index.js');
  const events = []; let submittedAt = 0;
  client = new CanonicalClient({ baseUrl: origin, getToken: async () => token, requestTimeoutMs: 20000, connectTimeoutMs: 20000,
    persistSubmission: async submission => persistSubmission(submission),
    acknowledgeSubmission: async () => {},
    onEvent: event => { if (events.length < 5000) events.push({ event, elapsed: submittedAt ? Math.round(now() - submittedAt) : null }); },
  });
  await timed('connect', () => client.connect());
  const created = await timed('create', () => client.createSession({ title: 'Hermes Mobile synthetic latency probe' }));
  session = created.session_id;
  if (typeof session !== 'string' || !session) throw new Error('Session');
  evidence.cleanup = 'archive_pending';
  writeFileSync(join(directory, 'latency-session.json'), JSON.stringify({ session_id: session }));
  const before = metadata(await timed('resume', () => client.openSession(session)));
  submittedAt = now();
  const receipt = await timed('submit_receipt', () => client.submit({ session_id: session, submission_id: randomUUID(), text: 'Do not use tools. Reply with exactly this sentence and nothing else: The blue lantern is ready for another conversation.' }));
  if (typeof receipt.admission_id !== 'string' || !receipt.admission_id) throw new Error('Admission');
  stage = 'reply';
  const until = Date.now() + 120000;
  let complete;
  while (Date.now() < until) {
    const matching = events.filter(({ event }) => event.session_id === session && event.admission_id === receipt.admission_id);
    const first = matching.find(({ event }) => event.type === 'message.delta' && typeof event.payload?.text === 'string' && event.payload.text.length);
    if (first) evidence.timings_ms.first_text_from_submit = first.elapsed;
    complete = matching.find(({ event }) => event.type === 'message.complete');
    if (complete) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!complete || complete.event.payload?.status !== 'complete') throw new Error('Reply');
  evidence.timings_ms.complete_from_submit = complete.elapsed;
  evidence.reply_characters = String(complete.event.payload.text ?? '').length;
  evidence.pending_statuses = [...new Set(events.flatMap(({event}) => Array.isArray(event.payload?.pending) ? event.payload.pending.map(item => item?.status).filter(status => ['queued','started','unknown','completed','cancelled','failed','steered','interrupted'].includes(status)) : []))];
  const after = metadata(await client.refreshSession(session));
  evidence.metadata_unchanged = compareMetadata(before, after);
  if (!Object.values(evidence.metadata_unchanged).every(value => value === true)) throw new Error('Metadata changed or unverified');
  evidence.model = /^[\w./:+-]{1,120}$/.test(before.model ?? '') ? before.model : null;
  evidence.reasoning = /^[\w-]{0,30}$/.test(before.effort ?? '') ? before.effort : null;
  const sentence = 'A little more room to think, and a little less waiting between the words. ';
  for (const length of [320, 1900]) {
    const result = await timed(`synthesis_${length}_characters`, () => audio('speak', { text: sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length) }, token));
    if (typeof result.data_url !== 'string' || !result.data_url.startsWith('data:audio/')) throw new Error('Speech');
  }
  evidence.result = 'passed';
} catch { evidence.result = 'failed'; evidence.failed_stage = stage; process.exitCode = 1; }
finally {
  if (session && client) {
    try { await client.mutate(session, 'archive', { archived: true }); evidence.cleanup = 'archived'; }
    catch { evidence.cleanup = 'archive_failed'; evidence.result = 'failed'; process.exitCode = 1; }
  }
  client?.close(); evidence.finished_at = new Date().toISOString(); save();
  console.log(JSON.stringify(evidence));
}
