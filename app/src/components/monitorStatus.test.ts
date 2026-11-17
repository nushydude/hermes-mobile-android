import { describe, expect, it } from "vitest";
import { monitorStatus } from "./monitorStatus";
describe("monitor status", () => {
  const base = {mode:"whileturnruns",started:false,starting:false,idle:false,configured:true,active:true,failed:false};
  it("reports actual activity ahead of selected mode, including delayed stop", () => {
    expect(monitorStatus({...base,mode:"off",started:true})).toBe("running");
    expect(monitorStatus({...base,started:true,idle:true})).toBe("finishing");
    expect(monitorStatus({...base,starting:true})).toBe("starting");
    expect(monitorStatus(base)).toBe("waiting");
  });
  it("exposes setup, background and startup failure instead of claiming it is running", () => {
    expect(monitorStatus({...base,configured:false})).toBe("setup");
    expect(monitorStatus({...base,active:false})).toBe("background");
    expect(monitorStatus({...base,failed:true})).toBe("error");
    expect(monitorStatus({...base,mode:"off"})).toBe("off");
  });
});
