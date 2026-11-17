/** Opt-in, in-memory, content-free timing collection. Never accepts external identifiers or text. */
export type DiagnosticStage = 'capture_end' | 'transcription_start' | 'transcription_end' | 'submission_start' | 'submission_saved' | 'reply_complete' | 'playback_start';
export type DiagnosticEvent = { trace: number; stage: DiagnosticStage; elapsedMs: number };
const stages = new Set<DiagnosticStage>(['capture_end','transcription_start','transcription_end','submission_start','submission_saved','reply_complete','playback_start']);

export class ConversationDiagnostics {
  private enabled = false;
  private next = 0;
  private starts = new Map<number, {at:number; seen:Set<DiagnosticStage>}>();
  private events: DiagnosticEvent[] = [];
  constructor(private readonly clock: () => number, private readonly capacity = 500) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5000) throw new RangeError('Invalid diagnostic capacity');
  }
  isEnabled() { return this.enabled; }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) { this.starts.clear(); this.events = []; }
  }
  begin(): number | null {
    if (!this.enabled) return null;
    let now: number; try { now = this.clock(); } catch { return null; }
    if (!Number.isFinite(now)) return null;
    const trace = ++this.next;
    this.starts.set(trace, {at:now,seen:new Set()});
    while (this.starts.size > this.capacity) this.starts.delete(this.starts.keys().next().value!);
    return trace;
  }
  mark(trace: number | null, stage: DiagnosticStage) {
    if (!this.enabled || trace === null || !stages.has(stage)) return;
    let now: number; try { now = this.clock(); } catch { return; }
    const start = this.starts.get(trace);
    if (start === undefined || start.seen.has(stage) || !Number.isFinite(now) || now < start.at) return;
    start.seen.add(stage);
    this.events.push({trace, stage, elapsedMs: Math.round(now - start.at)});
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
  }
  end(trace: number | null) { if (trace !== null) this.starts.delete(trace); }
  export(): DiagnosticEvent[] { return this.events.map(event => ({...event})); }
}

export const conversationDiagnostics = new ConversationDiagnostics(() => performance.now());
