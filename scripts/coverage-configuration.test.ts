import { describe, expect, it } from "vitest";
import vitestConfiguration from "../vitest.config";

type CoverageConfiguration = {
  exclude?: string[];
  excludeAfterRemap?: boolean;
  include?: string[];
  thresholds?: {
    branches?: number;
    functions?: number;
    lines?: number;
    statements?: number;
  };
};

describe("coverage configuration", () => {
  it("measures all production code against the rounded baseline ratchets", () => {
    const coverageConfiguration = (
      vitestConfiguration as { test?: { coverage?: CoverageConfiguration } }
    ).test?.coverage;

    expect(coverageConfiguration?.include).toEqual([
      "apps/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "packages/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ]);
    expect(coverageConfiguration?.exclude).toEqual([
      "**/*.test.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "**/*.spec.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "**/*.worker-spec.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "**/*.d.{ts,mts,cts}",
      "**/dist/**",
      "**/.wrangler/**",
    ]);
    expect(coverageConfiguration?.excludeAfterRemap).toBe(true);
    expect(coverageConfiguration?.thresholds).toEqual({
      statements: 74,
      branches: 65,
      functions: 73,
      lines: 76,
    });
  });
});
