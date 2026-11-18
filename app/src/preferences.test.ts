import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("expo-sqlite", () => ({
  openDatabaseSync: () => ({
    execSync: vi.fn(),
    getFirstSync: () => (storage.value === undefined ? null : { value: storage.value }),
    runSync: (_sql: string, _key: string, value: string) => {
      storage.value = value;
    },
  }),
}));
vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => boolean) => getSnapshot(),
}));

describe("activity preference", () => {
  beforeEach(() => {
    storage.value = undefined;
    vi.resetModules();
  });
  it("defaults off and persists changes across store reloads", async () => {
    let preferences = await import("./preferences");
    expect(preferences.useShowActivity()).toBe(false);
    preferences.setShowActivity(true);
    vi.resetModules();
    preferences = await import("./preferences");
    expect(preferences.useShowActivity()).toBe(true);
    preferences.setShowActivity(false);
    vi.resetModules();
    preferences = await import("./preferences");
    expect(preferences.useShowActivity()).toBe(false);
  });
});

describe("speak replies preference", () => {
  beforeEach(() => {
    storage.value = undefined;
    vi.resetModules();
  });
  it("leaves legacy behavior unset and persists explicit on and off", async () => {
    let p = await import("./preferences");
    expect(p.getSpeakReplies()).toBeNull();
    p.setSpeakReplies(true);
    vi.resetModules();
    p = await import("./preferences");
    expect(p.getSpeakReplies()).toBe(true);
    p.setSpeakReplies(false);
    vi.resetModules();
    p = await import("./preferences");
    expect(p.getSpeakReplies()).toBe(false);
  });
});
