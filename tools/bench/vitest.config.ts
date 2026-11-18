import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tools/bench/scenarios.ts"], environment: "node", testTimeout: 120_000 },
});
