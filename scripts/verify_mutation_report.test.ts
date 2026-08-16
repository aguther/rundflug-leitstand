import { describe, expect, it } from "vitest";
import { verifyMutationReport } from "./verify_mutation_report.mjs";

const criticalFiles = [
  "packages/domain/src/capacity.ts",
  "packages/domain/src/forecast-availability.ts",
  "packages/domain/src/forecast-diagnostics.ts",
  "packages/domain/src/forecast-dispatch-replay.ts",
  "packages/domain/src/forecast-sampling.ts",
  "packages/domain/src/outage-recovery.ts",
  "packages/domain/src/queue.ts",
  "packages/domain/src/ticket-group-recall.ts",
  "packages/domain/src/turnaround.ts",
];

function mutant(status: string) {
  return { status };
}

function report(score = 90) {
  const detected = Math.round(score);
  return {
    files: Object.fromEntries(
      criticalFiles.map((path) => [
        path,
        {
          mutants: [
            ...Array.from({ length: detected }, () => mutant("Killed")),
            ...Array.from({ length: 100 - detected }, () => mutant("Survived")),
            mutant("Ignored"),
          ],
        },
      ]),
    ),
  };
}

describe("mutation report ratchet", () => {
  it("accepts reports above both global and per-file thresholds", () => {
    expect(verifyMutationReport(report())).toHaveLength(criticalFiles.length + 1);
  });

  it("rejects a missing critical module", () => {
    const input = report();
    delete input.files[criticalFiles[0] ?? ""];
    expect(() => verifyMutationReport(input)).toThrow("missing from mutation report");
  });

  it("rejects a module below eighty percent", () => {
    const input = report();
    input.files[criticalFiles[0] ?? ""] = {
      mutants: [
        ...Array.from({ length: 79 }, () => mutant("Timeout")),
        ...Array.from({ length: 21 }, () => mutant("NoCoverage")),
      ],
    };
    expect(() => verifyMutationReport(input)).toThrow("is below 80%");
  });

  it("rejects a global score below the ratchet", () => {
    expect(() => verifyMutationReport(report(86))).toThrow("is below 87%");
  });
});
