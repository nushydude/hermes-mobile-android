export const EXPECTED_WORDS = 'remember the blue lantern number seven';
export function normalizeTranscript(value) {
  if (typeof value !== 'string' || value.length > 300 || !/^[A-Za-z0-9\s.,!?'-]+$/.test(value)) return null;
  return value.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
export function transcriptDiagnostic(value) {
  const text = typeof value === 'string' ? value : '';
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const allowed = new Set(['remember','the','blue','lantern','number','seven','7']);
  return {transcript_empty:!text.trim(),transcript_word_count:words.length,transcript_tokens:words.slice(0,64).map(word=>allowed.has(word)?word:'[other]'),transcript_tokens_truncated:words.length>64};
}
export function numberRendering(value) { const normalized=normalizeTranscript(value); return normalized === EXPECTED_WORDS ? 'word' : normalized === 'remember the blue lantern number 7' ? 'digit' : null; }
export function matchedTranscript(value) { return numberRendering(value) ? EXPECTED_WORDS : null; }
export function audioMime(value) { const mime=String(value ?? '').split(';')[0].trim().toLowerCase(); return ['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave','audio/ogg','audio/opus','audio/webm','audio/mp4'].includes(mime) ? mime : null; }
export function completionFor(events, from, session, receipt) {
  if (typeof receipt?.admission_id !== 'string' || !receipt.admission_id) return undefined;
  return events.slice(from).find(e=>e?.type==='message.complete' && e.session_id===session && e.admission_id===receipt.admission_id);
}
export function metadata(snapshot) {
  const info=snapshot && typeof snapshot.info==='object' && snapshot.info ? snapshot.info : {};
  const model=typeof info.model==='string' && info.model ? info.model : null;
  const provider=typeof info.provider==='string' && info.provider ? info.provider : null;
  const effort=typeof info.reasoning_effort==='string' ? info.reasoning_effort : null;
  return {model,provider,effort};
}
export function compareMetadata(before, after) {
  return {model:before.model && after.model ? before.model===after.model : null, provider:before.provider && after.provider ? before.provider===after.provider : null, effort:before.effort !== null && after.effort !== null ? before.effort===after.effort : null};
}
export function userRows(rows,text) { return Array.isArray(rows) ? rows.filter(row=>row?.role==='user' && (row.text===text || row.content===text)) : []; }
export async function boundedBytes(response,limit) {
  const announced=Number(response.headers.get('content-length')); if (Number.isFinite(announced) && announced > limit) throw new Error('size limit');
  if (!response.body) throw new Error('missing body');
  const reader=response.body.getReader(); const chunks=[]; let size=0;
  try { while (true) { const {done,value}=await reader.read(); if (done) break; size+=value.length; if(size>limit) { await reader.cancel(); throw new Error('size limit'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const out=new Uint8Array(size); let pos=0; for(const chunk of chunks) {out.set(chunk,pos);pos+=chunk.length;} return out;
}
