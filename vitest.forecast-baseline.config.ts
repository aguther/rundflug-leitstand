import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["apps/web/src/features/forecast-simulation/comparison.baseline.test.ts"],
    maxWorkers: 1,
    testTimeout: 300_000,
  },
});
