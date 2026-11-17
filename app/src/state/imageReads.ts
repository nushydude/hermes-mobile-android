/** Shared image downloads with caller cancellation and a byte-bounded LRU. */
export class ImageReads {
  private cache = new Map<string,string>();
  private bytes = 0;
  private flights = new Map<string,{controller:AbortController; users:number; done:boolean; promise:Promise<string>}>();
  constructor(private readonly maxBytes = 8 * 1024 * 1024) {}
  read(key:string, load:(signal:AbortSignal) => Promise<string>, signal?:AbortSignal): Promise<string> {
    if (signal?.aborted) return Promise.reject(new Error('Image request cancelled'));
    const cached = this.cache.get(key);
    if (cached !== undefined) { this.cache.delete(key); this.cache.set(key,cached); return Promise.resolve(cached); }
    let flight = this.flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      flight = {controller,users:0,done:false,promise:Promise.resolve('')};
      const current = flight;
      this.flights.set(key,current);
      const timer = setTimeout(() => controller.abort(),60_000);
      current.promise = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('Image request cancelled');
        return load(controller.signal);
      }).then(value => {
        if (controller.signal.aborted) throw new Error('Image request cancelled');
        if (value.length * 2 <= this.maxBytes) {
          this.cache.set(key,value); this.bytes += value.length * 2;
          while (this.bytes > this.maxBytes || this.cache.size > 32) {
            const oldest = this.cache.entries().next().value!;
            this.cache.delete(oldest[0]); this.bytes -= oldest[1].length * 2;
          }
        }
        return value;
      }).finally(() => {
        current.done = true; clearTimeout(timer);
        if (this.flights.get(key) === current) this.flights.delete(key);
      });
    }
    const current = flight; current.users++;
    return new Promise((resolve,reject) => {
      let settled = false;
      const finish = (value:string | Error) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort',abort); current.controller.signal.removeEventListener('abort',abort);
        current.users--;
        if (!current.users && !current.done) {
          if (this.flights.get(key) === current) this.flights.delete(key);
          current.controller.abort();
        }
        if (value instanceof Error) reject(value); else resolve(value);
      };
      const abort = () => finish(new Error('Image request cancelled'));
      signal?.addEventListener('abort',abort,{once:true}); current.controller.signal.addEventListener('abort',abort,{once:true});
      current.promise.then(value => finish(value),error => finish(error instanceof Error ? error : new Error('Image could not be loaded')));
      if (signal?.aborted || current.controller.signal.aborted) abort();
    });
  }
  clear() {
    this.cache.clear(); this.bytes = 0;
    for (const flight of this.flights.values()) flight.controller.abort();
    this.flights.clear();
  }
}
