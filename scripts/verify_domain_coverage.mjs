import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const criticalDomainFiles = [
  "packages/domain/src/capacity.ts",
  "packages/domain/src/forecast-availability.ts",
  "packages/domain/src/forecast-diagnostics.ts",
  "packages/domain/src/forecast-dispatch-replay.ts",
  "packages/domain/src/forecast-projection.ts",
  "packages/domain/src/forecast-sampling.ts",
  "packages/domain/src/outage-recovery.ts",
  "packages/domain/src/queue.ts",
  "packages/domain/src/ticket-group-recall.ts",
  "packages/domain/src/turnaround.ts",
];

const minimumLineCoverage = 90;
const minimumBranchCoverage = 85;

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

export function verifyCriticalDomainCoverage(summary) {
  const entries = Object.entries(summary).map(([path, coverage]) => [
    normalizePath(path),
    coverage,
  ]);
  const failures = [];
  const observations = [];

  for (const expectedPath of criticalDomainFiles) {
    const entry = entries.find(([path]) => path.endsWith(expectedPath));
    if (!entry) {
      failures.push(`${expectedPath}: missing from coverage summary`);
      continue;
    }
    const coverage = entry[1];
    const lines = Number(coverage.lines?.pct ?? 0);
    const branches = Number(coverage.branches?.pct ?? 0);
    observations.push(`${expectedPath}: ${lines}% lines, ${branches}% branches`);
    if (lines < minimumLineCoverage) {
      failures.push(`${expectedPath}: line coverage ${lines}% is below ${minimumLineCoverage}%`);
    }
    if (branches < minimumBranchCoverage) {
      failures.push(
        `${expectedPath}: branch coverage ${branches}% is below ${minimumBranchCoverage}%`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Critical domain coverage failed:\n${failures.join("\n")}`);
  }
  return observations;
}

async function run() {
  const summaryPath = resolve(repositoryRoot, "coverage", "coverage-summary.json");
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  for (const observation of verifyCriticalDomainCoverage(summary)) console.log(observation);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run();
