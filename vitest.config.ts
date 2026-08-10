import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/worker/**/*.test.ts",
      "apps/web/**/*.test.{ts,tsx}",
      "scripts/**/*.test.ts",
    ],
    coverage: {
      reporter: ["text", "html", "lcov"],
    },
  },
});
