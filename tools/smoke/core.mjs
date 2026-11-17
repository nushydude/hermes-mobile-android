export class RpcError extends Error {
  constructor(method, code, message, data) {
    super(`RPC ${method} failed (code ${code}): ${message}`);
    this.method = method;
    this.code = code;
    this.data = {};
    if (typeof data?.reason === 'string' && /^[a-z_]+$/.test(data.reason)) this.data.reason = data.reason;
    if (Number.isSafeInteger(data?.revision)) this.data.revision = data.revision;
    if (Number.isSafeInteger(data?.execution_generation)) this.data.execution_generation = data.execution_generation;
  }
}

export async function mutateWithRetry(call, params, observe = () => {}) {
  try { return await call('session.mutate', params); }
  catch (error) {
    if (!(error instanceof RpcError) || !['revision_conflict','stale_generation'].includes(error.data.reason)) throw error;
    if (!Number.isSafeInteger(error.data.revision) || !Number.isSafeInteger(error.data.execution_generation)) throw error;
    const next = {...params, expected_revision:error.data.revision};
    if ('expected_generation' in params || error.data.reason === 'stale_generation') next.expected_generation = error.data.execution_generation;
    observe(error.data);
    return await call('session.mutate', next);
  }
}

export function latestVersion(events, sid, revision, generation) {
  for (const e of events) {
    if (e.session_id !== sid || e.type !== 'session.info') continue;
    if (Number.isSafeInteger(e.payload?.revision)) revision = Math.max(revision, e.payload.revision);
    if (Number.isSafeInteger(e.payload?.execution_generation)) generation = e.payload.execution_generation;
  }
  return {revision, generation};
}

export function findCompletion(sid, ...eventGroups) {
  return eventGroups.flat().find(e => e.session_id === sid && e.type === 'message.complete');
}

// Handoff checkpoints use a cursor so a previous event cannot satisfy a later
// check. Prompt IDs bind a settlement to the specific approval under test.
export function findHandoffEvent(events, from, sid, predicate, promptId) {
  for (let index = from; index < events.length; index++) {
    const event = events[index];
    if (event.session_id !== sid || !predicate(event)) continue;
    if (promptId && event.payload?.prompt_id !== promptId) continue;
    return {event, index};
  }
  return undefined;
}

// Require an unambiguous structured observation, optionally in a Markdown fence.
export function imageAnswerMatches(text) {
  if (typeof text !== 'string') return false;
  const value = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  try {
    const parsed = JSON.parse(value);
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      Object.keys(parsed).length === 2 && parsed.left === 'red' && parsed.right === 'blue';
  } catch { return false; }
}

export function isDisconnectTrigger(event) {
  return event?.type === 'message.delta' && typeof event.payload?.text === 'string' && event.payload.text.length > 0;
}

// Replay and live delivery can overlap. Require contiguous UTF-16 offsets, reject
// inconsistent overlaps and sequence duplicates, and reconstruct text per segment.
export function reconstructDeltas(events, sid) {
  const bySequence = new Map();
  for (const event of events) {
    if (event.session_id !== sid || !Number.isSafeInteger(event.seq)) continue;
    const old = bySequence.get(event.seq);
    if (old && JSON.stringify(old) !== JSON.stringify(event)) throw new Error('Conflicting replay sequence');
    bySequence.set(event.seq, event);
  }
  const segments = new Map();
  for (const event of [...bySequence.values()].sort((a,b) => a.seq-b.seq)) {
    if (event.type !== 'message.delta' || typeof event.payload?.text !== 'string') continue;
    const {segment, offset, text} = event.payload;
    if (!Number.isSafeInteger(segment) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Missing delta position');
    const current = segments.get(segment) || '';
    if (offset > current.length) throw new Error('Delta gap');
    const overlap = Math.min(current.length-offset, text.length);
    if (current.slice(offset,offset+overlap) !== text.slice(0,overlap)) throw new Error('Conflicting delta overlap');
    segments.set(segment,current+text.slice(overlap));
  }
  return [...segments.entries()].sort((a,b) => a[0]-b[0]).map(([,s]) => s).join('');
}

export function armDisconnect(channel, sessionId) {
  let disconnected = false;
  return event => {
    if (!disconnected && event.session_id === sessionId && isDisconnectTrigger(event)) {
      if (channel.events.some(e => e.session_id === sessionId && e.type === 'message.complete')) return;
      disconnected = true;
      channel.close();
    }
  };
}
