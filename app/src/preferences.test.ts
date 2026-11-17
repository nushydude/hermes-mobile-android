import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("expo-sqlite", () => ({
  openDatabaseSync: () => ({
    execSync: vi.fn(),
    getFirstSync: () =>
      storage.value === undefined ? null : { value: storage.value },
    runSync: (_sql: string, _key: string, value: string) => {
      storage.value = value;
    },
  }),
}));
vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => boolean) =>
    getSnapshot(),
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
