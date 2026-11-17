import { randomUUID } from 'node:crypto';

export const stages = ['transcription','connect','create','resume','submit_receipt','first_text_from_submit','complete_from_submit','synthesis_320_characters','synthesis_1900_characters'];
const voiceStages = ['capture_end','transcription_start','transcription_end','submission_start','submission_saved','reply_complete','playback_start'];
const arms = new Set(['baseline','candidate']);

export function parseLiveArgs(args) {
  if (args.length !== 3 || args[0] !== '--run-live' || args[1] !== '--arm' || !arms.has(args[2])) throw new Error('Explicit --run-live --arm baseline|candidate required');
  return {arm:args[2]};
}
export function runDirectory(arm, id = randomUUID()) {
  if (!arms.has(arm) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid run identity');
  return `.artifacts/conversational-latency/${arm}-${id}`;
}
const finiteTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400000;
function validRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || !arms.has(r.arm) || !['passed','failed','incomplete'].includes(r.result)) throw new Error('Invalid input');
  const allowed = new Set(['arm','result','timings_ms','events','started_at','finished_at','cleanup','failed_stage','transcript_characters','reply_characters','pending_statuses','metadata_unchanged','model','reasoning']);
  if (Object.keys(r).some(k=>!allowed.has(k)) || ('events' in r && 'timings_ms' in r)) throw new Error('Invalid input');
  return r;
}
export function summarize(records) {
  if (!Array.isArray(records) || records.length > 1000) throw new Error('Invalid input');
  const groups = {};
  for (const input of records) {
    const r = validRecord(input);
    const kind=Array.isArray(r.events)?'events':'timings';
    const group = groups[r.arm] ??= {kind,runs:0, failures:0, incomplete:0, stages:{}};
    if(group.kind!==kind)throw new Error('Invalid input');
    group.runs++;
    if (r.result === 'failed') group.failures++;
    if (r.result === 'incomplete') group.incomplete++;
    let values = {};
    if (Array.isArray(r.events)) {
      if (r.events.length > 5000) throw new Error('Invalid input');
      const traces = new Map();
      for (const e of r.events) {
        if (!e || typeof e !== 'object' || Object.keys(e).some(k=>!['trace','stage','elapsedMs'].includes(k)) || !Number.isSafeInteger(e.trace) || e.trace < 0 || !voiceStages.includes(e.stage) || !finiteTime(e.elapsedMs)) throw new Error('Invalid input');
        const trace=traces.get(e.trace) ?? {};if(e.stage in trace) throw new Error('Invalid input');trace[e.stage]=e.elapsedMs;traces.set(e.trace,trace);
      }
      // An event export is one aggregate, not one per-turn sample. Avoid falsely
      // treating multiple trace events as independent benchmark runs.
      if (traces.size > 1) throw new Error('One trace per input required');
      const trace=[...traces.values()][0] ?? {};
      for (const [name,a,b] of [['stt_tail','transcription_start','transcription_end'],['reply_after_submit','submission_start','reply_complete'],['audio_after_reply','reply_complete','playback_start']]) {
        if (a in trace && b in trace && trace[b] >= trace[a]) values[name]=trace[b]-trace[a];
      }
    } else {
      if (!r.timings_ms || typeof r.timings_ms !== 'object' || Array.isArray(r.timings_ms)) throw new Error('Invalid input');
      for (const k of Object.keys(r.timings_ms)) if (!stages.includes(k) || !finiteTime(r.timings_ms[k])) throw new Error('Invalid input');
      values = r.timings_ms;
    }
    const names = Array.isArray(r.events) ? ['stt_tail','reply_after_submit','audio_after_reply'] : stages;
    for (const name of names) {
      const entry=group.stages[name] ??= {samples:[],missing:0};
      if (r.result === 'passed' && finiteTime(values[name])) entry.samples.push(values[name]); else entry.missing++;
    }
  }
  for (const group of Object.values(groups)) for (const [name, entry] of Object.entries(group.stages)) {
    entry.samples.sort((a,b)=>a-b);const n=entry.samples.length;
    group.stages[name]={n,missing:entry.missing,median:n?(n%2?entry.samples[(n-1)/2]:(entry.samples[n/2-1]+entry.samples[n/2])/2):null,p95:n?entry.samples[Math.ceil(.95*n)-1]:null};
  }
  return groups;
}
