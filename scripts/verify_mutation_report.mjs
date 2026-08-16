import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const criticalDomainFiles = [
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

const detectedStatuses = new Set(["Killed", "Timeout"]);
const measuredStatuses = new Set(["Killed", "Timeout", "Survived", "NoCoverage"]);
const minimumGlobalScore = 87;
const minimumFileScore = 80;

function mutationScore(mutants) {
  const measured = mutants.filter((mutant) => measuredStatuses.has(mutant.status));
  if (measured.length === 0) return 0;
  const detected = measured.filter((mutant) => detectedStatuses.has(mutant.status));
  return (detected.length / measured.length) * 100;
}

export function verifyMutationReport(report) {
  const failures = [];
  const observations = [];
  const allMutants = [];

  for (const expectedPath of criticalDomainFiles) {
    const file = report.files?.[expectedPath];
    if (!file || !Array.isArray(file.mutants)) {
      failures.push(`${expectedPath}: missing from mutation report`);
      continue;
    }
    allMutants.push(...file.mutants);
    const score = mutationScore(file.mutants);
    observations.push(`${expectedPath}: ${score.toFixed(2)}% mutation score`);
    if (score < minimumFileScore) {
      failures.push(
        `${expectedPath}: mutation score ${score.toFixed(2)}% is below ${minimumFileScore}%`,
      );
    }
  }

  const globalScore = mutationScore(allMutants);
  observations.unshift(`focused mutation score: ${globalScore.toFixed(2)}%`);
  if (globalScore < minimumGlobalScore) {
    failures.push(
      `focused mutation score ${globalScore.toFixed(2)}% is below ${minimumGlobalScore}%`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Mutation ratchet failed:\n${failures.join("\n")}`);
  }
  return observations;
}

async function run() {
  const reportPath = resolve(repositoryRoot, "reports", "mutation", "mutation.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  for (const observation of verifyMutationReport(report)) console.log(observation);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run();
