import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Each shard runs in its own GitHub job. Suites inside a shard are deliberately serial so that
// one runner never starts competing Wrangler/workerd processes against the same CPU and filesystem.
export const integrationShards = [
  {
    name: "1",
    suites: [
      "test:vertical-slice",
      "test:ticket-corrections",
      "test:ticket-group-recall",
      "test:public-monitors",
    ],
  },
  {
    name: "2",
    suites: [
      "test:master-data",
      "test:queue-grouping",
      "test:ticket-deferrals",
      "test:sale-guards",
      "test:first-run-setup",
    ],
  },
  {
    name: "3",
    suites: [
      "test:ticket-assignment-concurrency",
      "test:fleet-operations",
      "test:recurring-operational-rules",
      "test:pilot-conflict",
      "test:emergency-mode",
    ],
  },
  {
    name: "4",
    suites: [
      "test:automatic-precall",
      "test:outage-recovery",
      "test:factory-reset",
      "test:scale-performance",
    ],
  },
];

export const suites = integrationShards.flatMap((shard) => shard.suites);

export function parseShardSelection(argumentsList) {
  const shardArgument = argumentsList.find((argument) => argument.startsWith("--shard="));
  const unknownArgument = argumentsList.find((argument) => !argument.startsWith("--shard="));
  if (unknownArgument) throw new Error(`Unknown V1 integration argument: ${unknownArgument}`);
  if (!shardArgument) return { name: "all", suites };

  const match = shardArgument.match(/^--shard=(\d+)\/(\d+)$/);
  if (!match) throw new Error("--shard must use the form <index>/<total>.");
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total !== integrationShards.length || index < 1 || index > total) {
    throw new Error(
      `--shard must select 1/${integrationShards.length} through ${integrationShards.length}/${integrationShards.length}.`,
    );
  }
  const selected = integrationShards[index - 1];
  if (!selected) throw new Error(`V1 integration shard ${index} is not configured.`);
  return selected;
}

export async function runSequentialSuites({ selectedSuites, shardName, runSuite }) {
  const results = [];
  for (const suite of selectedSuites) results.push(await runSuite(suite, shardName));
  return results;
}

function runNpmSuite(npmCli, suite, shardName) {
  return new Promise((resolvePromise, reject) => {
    const suiteStartedAt = Date.now();
    process.stdout.write(`[v1-integrations] start ${suite} (shard ${shardName})\n`);
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
        const failureReason = signal
          ? ` with signal ${signal}`
          : ` with exit code ${status ?? "unknown"}`;
        reject(new Error(`${suite} failed${failureReason}.`));
        return;
      }
      process.stdout.write(
        `[v1-integrations] pass ${suite} (shard ${shardName}, ${durationSeconds.toFixed(1)}s)\n`,
      );
      resolvePromise({ suite, shard: shardName, durationSeconds });
    });
  });
}

async function writeReport(report) {
  const reportPath = process.env.V1_INTEGRATION_REPORT;
  if (!reportPath) return;
  const absolutePath = resolve(root, reportPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("The npm execution path is missing.");

  const selection = parseShardSelection(process.argv.slice(2));
  const startedAt = Date.now();
  try {
    const results = await runSequentialSuites({
      selectedSuites: selection.suites,
      shardName: selection.name,
      runSuite: (suite, shardName) => runNpmSuite(npmCli, suite, shardName),
    });
    const report = {
      ok: true,
      maximumParallelSuites: 1,
      shard: selection.name,
      suiteCount: results.length,
      suites: results,
      totalDurationSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
    };
    await writeReport(report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    await writeReport({
      ok: false,
      maximumParallelSuites: 1,
      shard: selection.name,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message.slice(0, 2_000) }
          : { name: "UnknownError" },
      totalDurationSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
    });
    throw error;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
