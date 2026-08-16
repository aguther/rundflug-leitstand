import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/web/src/features/forecast-simulation/comparison.baseline.test.ts"],
  },
});
