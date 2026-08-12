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
      include: [
        "apps/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
        "packages/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      ],
      exclude: [
        "**/*.test.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
        "**/*.spec.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
        "**/*.worker-spec.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
        "**/*.d.{ts,mts,cts}",
        "**/dist/**",
        "**/.wrangler/**",
      ],
      excludeAfterRemap: true,
      reporter: ["text", "html", "lcov"],
      thresholds: {
        statements: 62,
        branches: 56,
        functions: 60,
        lines: 64,
      },
    },
  },
});
