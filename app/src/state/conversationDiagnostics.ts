/** Opt-in, in-memory, content-free timing collection. Never accepts external identifiers or text. */
export type DiagnosticStage =
  | "capture_end"
  | "transcription_start"
  | "transcription_end"
  | "submission_start"
  | "submission_saved"
  | "submit_sent"
  | "first_delta"
  | "reply_complete"
  | "tts_request_start"
  | "tts_ready"
  | "playback_start";
export type DiagnosticEvent = { trace: number; stage: DiagnosticStage; elapsedMs: number };
const stages = new Set<DiagnosticStage>([
  "capture_end",
  "transcription_start",
  "transcription_end",
  "submission_start",
  "submission_saved",
  "submit_sent",
  "first_delta",
  "reply_complete",
  "tts_request_start",
  "tts_ready",
  "playback_start",
]);

/** Durations that are not part of a conversation trace. Only `persist_ms` carries a size. */
export type DiagnosticSampleName =
  "persist_ms" | "session_open_ms" | "connect_ready_ms" | "cache_restore_ms";
export type DiagnosticSample = { name: DiagnosticSampleName; ms: number; chars?: number };
const sampleNames = new Set<DiagnosticSampleName>([
  "persist_ms",
  "session_open_ms",
  "connect_ready_ms",
  "cache_restore_ms",
]);
/** Opaque start of a sample; null when diagnostics were off when it started. */
export type DiagnosticTimer = { readonly at: number; readonly generation: number };

export type RenderCounterName = "chat_screen" | "timeline_item" | "live_message" | "message_input";
const renderNames: readonly RenderCounterName[] = [
  "chat_screen",
  "timeline_item",
  "live_message",
  "message_input",
];
export type DiagnosticReport = {
  events: DiagnosticEvent[];
  samples: DiagnosticSample[];
  renders: Record<RenderCounterName, number>;
};

export class ConversationDiagnostics {
  private enabled = false;
  private generation = 0;
  private next = 0;
  private starts = new Map<number, { at: number; seen: Set<DiagnosticStage> }>();
  private events: DiagnosticEvent[] = [];
  private samples: DiagnosticSample[] = [];
  private renders = new Map<RenderCounterName, number>();
  constructor(
    private readonly clock: () => number,
    private readonly capacity = 500,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5000)
      throw new RangeError("Invalid diagnostic capacity");
  }
  isEnabled() {
    return this.enabled;
  }
  setEnabled(enabled: boolean) {
    if (enabled !== this.enabled) this.generation++;
    this.enabled = enabled;
    if (!enabled) {
      this.starts.clear();
      this.events = [];
      this.samples = [];
      this.renders.clear();
    }
  }
  private now(): number | null {
    try {
      const now = this.clock();
      return Number.isFinite(now) ? now : null;
    } catch {
      return null;
    }
  }
  begin(): number | null {
    if (!this.enabled) return null;
    const now = this.now();
    if (now === null) return null;
    const trace = ++this.next;
    this.starts.set(trace, { at: now, seen: new Set() });
    while (this.starts.size > this.capacity) this.starts.delete(this.starts.keys().next().value!);
    return trace;
  }
  mark(trace: number | null, stage: DiagnosticStage) {
    if (!this.enabled || trace === null || !stages.has(stage)) return;
    const now = this.now();
    const start = this.starts.get(trace);
    if (start === undefined || start.seen.has(stage) || now === null || now < start.at) return;
    start.seen.add(stage);
    this.events.push({ trace, stage, elapsedMs: Math.round(now - start.at) });
    if (this.events.length > this.capacity)
      this.events.splice(0, this.events.length - this.capacity);
  }
  end(trace: number | null) {
    if (trace !== null) this.starts.delete(trace);
  }
  /** Start a duration sample. Returns null, and costs one check, while diagnostics are off. */
  startTimer(): DiagnosticTimer | null {
    if (!this.enabled) return null;
    const at = this.now();
    return at === null ? null : { at, generation: this.generation };
  }
  /**
   * Record a duration since `timer`. Dropped if diagnostics were switched off at any point since
   * the timer started. `chars` is a payload length, never content.
   */
  sample(name: DiagnosticSampleName, timer: DiagnosticTimer | null, chars?: number) {
    if (!this.enabled || timer === null || timer.generation !== this.generation) return;
    if (!sampleNames.has(name)) return;
    const now = this.now();
    if (now === null || now < timer.at) return;
    const sample: DiagnosticSample = { name, ms: Math.round(now - timer.at) };
    if (chars !== undefined && Number.isSafeInteger(chars) && chars >= 0) sample.chars = chars;
    this.samples.push(sample);
    if (this.samples.length > this.capacity)
      this.samples.splice(0, this.samples.length - this.capacity);
  }
  /** Count one render of a named component or render path. */
  countRender(name: RenderCounterName) {
    if (!this.enabled || !renderNames.includes(name)) return;
    this.renders.set(name, Math.min((this.renders.get(name) ?? 0) + 1, Number.MAX_SAFE_INTEGER));
  }
  export(): DiagnosticEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
  /** Everything collected, for the "Copy response timings" export. */
  report(): DiagnosticReport {
    const renders = {} as Record<RenderCounterName, number>;
    for (const name of renderNames) renders[name] = this.renders.get(name) ?? 0;
    return {
      events: this.export(),
      samples: this.samples.map((sample) => ({ ...sample })),
      renders,
    };
  }
}

export const conversationDiagnostics = new ConversationDiagnostics(() => performance.now());

/**
 * Counts renders of the calling component under `name` while diagnostics are on. It uses no React
 * hooks, so while diagnostics are off it costs one boolean check per render.
 */
export function useRenderCounter(name: RenderCounterName) {
  if (conversationDiagnostics.isEnabled()) conversationDiagnostics.countRender(name);
}
