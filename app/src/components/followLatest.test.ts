import { describe, expect, it } from "vitest";
import { FollowLatest, isNearBottom } from "./followLatest";
describe("follow latest", () => {
  it("coalesces growth and cancels on drag, prepend, and session disposal; jump restores intent", () => {
    let next = 0, count = 0; const frames = new Map<number, () => void>();
    const controller = new FollowLatest(fn => { frames.set(++next,fn); return next; }, id => { frames.delete(id); }, () => count++);
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
    controller.changed(); controller.changed(); expect(frames.size).toBe(1);
    controller.dragStart(); flush(); expect(count).toBe(0);
    controller.dragEnd(); controller.changed(); flush(); expect(count).toBe(0);
    controller.jump(); expect(count).toBe(1);
    controller.prependStart(); controller.changed(); flush(); controller.prependEnd(); expect(count).toBe(1);
    controller.jump(); controller.changed(); controller.dispose(); flush(); expect(count).toBe(2);
  });
  it("does not follow growth during momentum and resumes only at the bottom", () => {
    let callback: (()=>void) | undefined; let count = 0;
    const c = new FollowLatest(fn => { callback=fn; return 1; }, () => { callback=undefined; }, () => count++);
    c.dragStart(); c.dragEnd(); c.momentumStart(); c.position(false); c.changed(); expect(callback).toBeUndefined();
    c.momentumEnd(true); c.changed(); callback?.(); expect(count).toBe(1);
  });
  it("uses fresh end geometry and stops following when momentum ends away from the bottom", () => {
    const atBottom = {contentOffset:{y:900},layoutMeasurement:{height:100},contentSize:{height:1000}};
    const away = {...atBottom,contentOffset:{y:500}};
    let callback: (()=>void) | undefined;
    const c = new FollowLatest(fn => { callback = fn; return 1; }, () => { callback = undefined; }, () => {});
    expect(isNearBottom(atBottom)).toBe(true);
    c.dragStart(); c.dragEnd(isNearBottom(away)); c.changed(); expect(callback).toBeUndefined();
    c.momentumStart(); c.position(true); c.momentumEnd(isNearBottom(away)); c.changed(); expect(callback).toBeUndefined();
  });
});
