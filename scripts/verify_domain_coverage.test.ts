import { describe, expect, it } from "vitest";
import { verifyCriticalDomainCoverage } from "./verify_domain_coverage.mjs";

const criticalFiles = [
  "capacity.ts",
  "forecast-availability.ts",
  "forecast-diagnostics.ts",
  "forecast-dispatch-replay.ts",
  "forecast-projection.ts",
  "forecast-sampling.ts",
  "outage-recovery.ts",
  "queue.ts",
  "ticket-group-recall.ts",
  "turnaround.ts",
];

function coverageSummary(lines = 90, branches = 85) {
  return Object.fromEntries(
    criticalFiles.map((file) => [
      `C:\\workspace\\packages\\domain\\src\\${file}`,
      { lines: { pct: lines }, branches: { pct: branches } },
    ]),
  );
}

describe("critical domain coverage ratchet", () => {
  it("accepts every critical module at the configured boundaries", () => {
    expect(verifyCriticalDomainCoverage(coverageSummary())).toHaveLength(criticalFiles.length);
  });

  it("reports missing modules and both coverage regressions", () => {
    const summary = coverageSummary();
    delete summary["C:\\workspace\\packages\\domain\\src\\capacity.ts"];
    summary["C:\\workspace\\packages\\domain\\src\\queue.ts"] = {
      lines: { pct: 89.99 },
      branches: { pct: 84.99 },
    };

    expect(() => verifyCriticalDomainCoverage(summary)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("capacity.ts: missing from coverage summary"),
      }),
    );
    expect(() => verifyCriticalDomainCoverage(summary)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("queue.ts: line coverage 89.99% is below 90%"),
      }),
    );
    expect(() => verifyCriticalDomainCoverage(summary)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("queue.ts: branch coverage 84.99% is below 85%"),
      }),
    );
  });
});
