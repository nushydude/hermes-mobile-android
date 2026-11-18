import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectionGrace } from "./connectionGrace.ts";
function clock() {
  let now = 0,
    id = 0;
  const timers = new Map();
  return {
    schedule(fn, delay) {
      const n = ++id;
      timers.set(n, { at: now + delay, fn });
      return n;
    },
    cancel(n) {
      timers.delete(n);
    },
    advance(ms) {
      now += ms;
      for (const [n, t] of [...timers])
        if (t.at <= now) {
          timers.delete(n);
          t.fn();
        }
    },
  };
}
test("startup grace expires after ten seconds despite connection state flaps", () => {
  const c = clock(),
    g = new ConnectionGrace("offline", c.schedule, c.cancel);
  assert.equal(g.getSnapshot(), true);
  c.advance(5000);
  g.update("connecting");
  g.update("reconnecting");
  c.advance(4999);
  assert.equal(g.getSnapshot(), true);
  c.advance(1);
  assert.equal(g.getSnapshot(), false);
  g.update("offline");
  assert.equal(g.getSnapshot(), false);
});
test("ready cancels grace, a new disconnect and foreground each get a fresh grace", () => {
  const c = clock(),
    g = new ConnectionGrace("connecting", c.schedule, c.cancel);
  c.advance(3000);
  g.update("ready");
  assert.equal(g.getSnapshot(), false);
  c.advance(9000);
  assert.equal(g.getSnapshot(), false);
  g.update("offline");
  assert.equal(g.getSnapshot(), true);
  c.advance(9000);
  g.foreground();
  c.advance(9000);
  assert.equal(g.getSnapshot(), true);
  c.advance(1000);
  assert.equal(g.getSnapshot(), false);
});
