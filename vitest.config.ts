import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/worker/**/*.test.ts",
      "apps/web/**/*.test.{ts,tsx}",
      "scripts/**/*.test.ts",
    ],
    exclude: [
      ...configDefaults.exclude,
      "apps/web/src/features/forecast-simulation/comparison.baseline.test.ts",
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
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        statements: 81,
        branches: 71,
        functions: 80,
        lines: 84,
      },
    },
  },
});
