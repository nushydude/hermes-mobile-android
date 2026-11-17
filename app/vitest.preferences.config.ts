import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "app/src/preferences.test.ts",
      "app/src/components/**/*.test.ts",
      "app/src/notificationCore.test.ts",
      "app/src/notificationText.test.ts",
      "app/src/notifications.test.ts",
    ],
    environment: "node",
  },
});
