export function sessionFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'hermesmobile:' || url.hostname !== 'session' || url.username || url.password || url.port || url.search || url.hash || !/^\/[^/]+$/.test(url.pathname)) return null;
    const id = decodeURIComponent(url.pathname.slice(1));
    return id && id.length <= 512 && !/[\u0000-\u001f\u007f]/.test(id) ? id : null;
  } catch { return null; }
}
export function sessionUrl(id: string) { return `hermesmobile://session/${encodeURIComponent(id)}`; }
export function eventKey(origin: string, event: any): string | null {
  if (!origin || !event.session_id || !event.replay_epoch || !Number.isSafeInteger(event.seq)) return null;
  return JSON.stringify([origin,event.session_id,event.replay_epoch,event.seq]);
}
export function taskTerminalKey(origin: string, event: any): string | null {
  const id = event?.payload?.subagent_id, status = event?.payload?.status;
  if (!origin || event?.type !== 'subagent.complete' || typeof event.session_id !== 'string' || !event.session_id || typeof id !== 'string' || !id || id.length > 512 || !['completed','failed','error','timeout','interrupted'].includes(status)) return null;
  return JSON.stringify(['task', origin, event.session_id, id]);
}
export function safeChoices(choices: unknown): ('once'|'deny')[] {
  if (!Array.isArray(choices)) return [];
  const values = choices.map(c => typeof c === 'string' ? c : c && typeof c === 'object' ? (c.value ?? c.id ?? c.label) : null);
  return (['once','deny'] as const).filter(c => values.includes(c));
}
export function validAction(data: any, origin: string, snapshot: any, choice: string) {
  if (!data || !origin || data.origin !== origin || !['once','deny'].includes(choice) || data.session !== snapshot?.session_id || String(snapshot.execution_generation) !== data.generation) return false;
  return Array.isArray(snapshot.prompts) && snapshot.prompts.some((p: any) => p && p.prompt_id === data.prompt && (p.execution_generation == null || String(p.execution_generation) === data.generation) && safeChoices(p.choices).includes(choice as 'once'|'deny') && !p.question && !String(p.kind ?? p.type ?? '').includes('clarify'));
}
