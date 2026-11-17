export class ConnectionGrace {
  private state: string;
  private hidden: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private schedule: typeof setTimeout;
  private cancel: typeof clearTimeout;
  constructor(initial: string, schedule = setTimeout, cancel = clearTimeout) {
    this.schedule = schedule; this.cancel = cancel;
    this.state = initial; this.hidden = initial !== 'ready';
    if (this.hidden) this.arm();
  }
  private arm() {
    if (this.timer) this.cancel(this.timer);
    this.hidden = true;
    this.timer = this.schedule(() => { this.timer = null; this.hidden = false; this.emit(); }, 10000);
    this.emit();
  }
  private emit() { this.listeners.forEach(listener => listener()); }
  update(state:string) {
    const previous = this.state; this.state = state;
    if (state === 'ready') { if (this.timer) this.cancel(this.timer); this.timer = null; if (this.hidden) { this.hidden = false; this.emit(); } }
    else if (previous === 'ready') this.arm();
  }
  foreground() { if (this.state !== 'ready') this.arm(); }
  getSnapshot = () => this.hidden;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => {this.listeners.delete(listener);}; };
}
