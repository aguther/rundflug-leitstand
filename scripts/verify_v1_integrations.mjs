import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");

const suites = [
  "test:vertical-slice",
  "test:master-data",
  "test:queue-grouping",
  "test:ticket-assignment-concurrency",
  "test:ticket-corrections",
  "test:ticket-deferrals",
  "test:automatic-precall",
  "test:sale-guards",
  "test:fleet-operations",
  "test:pilot-conflict",
  "test:emergency-mode",
  "test:outage-recovery",
  "test:public-monitors",
  "test:first-run-setup",
  "test:factory-reset",
  "test:scale-performance",
];

const startedAt = Date.now();
const results = [];
for (const suite of suites) {
  const suiteStartedAt = Date.now();
  const run = spawnSync(process.execPath, [npmCli, "run", suite], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (run.status !== 0) {
    throw new Error(
      `${suite} ist fehlgeschlagen${run.signal ? ` (Signal ${run.signal})` : ` (Exit ${run.status ?? "unbekannt"})`}.`,
    );
  }
  results.push({
    suite,
    durationSeconds: Number(((Date.now() - suiteStartedAt) / 1_000).toFixed(1)),
  });
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    suites: results,
    totalDurationSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
  })}\n`,
);
