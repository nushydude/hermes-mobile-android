import { describe, expect, it } from "vitest";
import { notificationPermissionState } from "./notificationPermission";
describe("notification permission", () => {
  it("distinguishes allowed, blocked and undetermined", () => {
    expect(notificationPermissionState(1)).toBe("enabled");
    expect(notificationPermissionState(2)).toBe("enabled");
    expect(notificationPermissionState(0)).toBe("blocked");
    expect(notificationPermissionState(-1)).toBe("request");
  });
});
