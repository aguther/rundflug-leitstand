import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// These suites use repository-local Wrangler state or need an exclusive Worker startup window.
export const exclusiveSuites = [
  "test:vertical-slice",
  "test:master-data",
  "test:ticket-assignment-concurrency",
  "test:ticket-deferrals",
  "test:automatic-precall",
  "test:sale-guards",
  "test:fleet-operations",
  "test:recurring-operational-rules",
  "test:pilot-conflict",
  "test:emergency-mode",
  "test:outage-recovery",
  "test:factory-reset",
  "test:scale-performance",
];

// These suites own temporary D1 state and ports and are safe beside the exclusive lane.
export const isolatedSuites = [
  "test:queue-grouping",
  "test:ticket-corrections",
  "test:ticket-group-recall",
  "test:public-monitors",
  "test:first-run-setup",
];

export const suites = [
  "test:vertical-slice",
  "test:master-data",
  "test:queue-grouping",
  "test:ticket-assignment-concurrency",
  "test:ticket-corrections",
  "test:ticket-deferrals",
  "test:ticket-group-recall",
  "test:automatic-precall",
  "test:sale-guards",
  "test:fleet-operations",
  "test:recurring-operational-rules",
  "test:pilot-conflict",
  "test:emergency-mode",
  "test:outage-recovery",
  "test:public-monitors",
  "test:first-run-setup",
  "test:factory-reset",
  "test:scale-performance",
];

export async function runSuiteLanes({ lanes, runSuite }) {
  let stopRequested = false;
  const runLane = async ({ name, laneSuites }) => {
    const results = [];
    for (const suite of laneSuites) {
      if (stopRequested) break;
      try {
        results.push(await runSuite(suite, name));
      } catch (error) {
        stopRequested = true;
        throw error;
      }
    }
    return results;
  };

  const outcomes = await Promise.allSettled(lanes.map(runLane));
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? outcome.value : []));
}

function runNpmSuite(npmCli, suite, lane) {
  return new Promise((resolvePromise, reject) => {
    const suiteStartedAt = Date.now();
    process.stdout.write(`[v1-integrations] start ${suite} (${lane})\n`);
    const child = spawn(process.execPath, [npmCli, "run", "--silent", suite], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (status, signal) => {
      const durationSeconds = Number(((Date.now() - suiteStartedAt) / 1_000).toFixed(1));
      if (status !== 0) {
        reject(
          new Error(
            `${suite} failed${signal ? ` with signal ${signal}` : ` with exit code ${status ?? "unknown"}`}.`,
          ),
        );
        return;
      }
      process.stdout.write(
        `[v1-integrations] pass ${suite} (${lane}, ${durationSeconds.toFixed(1)}s)\n`,
      );
      resolvePromise({ suite, lane, durationSeconds });
    });
  });
}

async function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("The npm execution path is missing.");

  const startedAt = Date.now();
  const results = await runSuiteLanes({
    lanes: [
      { name: "exclusive", laneSuites: exclusiveSuites },
      { name: "isolated", laneSuites: isolatedSuites },
    ],
    runSuite: (suite, lane) => runNpmSuite(npmCli, suite, lane),
  });
  const order = new Map(suites.map((suite, index) => [suite, index]));
  results.sort((left, right) => order.get(left.suite) - order.get(right.suite));

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      maximumParallelSuites: 2,
      exclusiveSuiteCount: exclusiveSuites.length,
      isolatedSuiteCount: isolatedSuites.length,
      suites: results,
      totalDurationSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
    })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
