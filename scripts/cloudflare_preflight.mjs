import { readFile } from "node:fs/promises";
import {
  d1DatabaseId,
  findJurisdiction,
  findNamedD1Database,
  generatedConfigPath,
  parseCloudflareTargetArguments,
  parseJsonOutput,
  requiredCloudflareSecrets,
  targetManifestPath,
} from "./cloudflare-target.mjs";
import { runWrangler } from "./lib/cloudflare-command.mjs";
import { withInfrastructureRetry } from "./lib/infrastructure-retry.mjs";

const profile = parseCloudflareTargetArguments(process.argv.slice(2));
const configPath = generatedConfigPath(profile);
const manifest = JSON.parse(await readFile(targetManifestPath(profile), "utf8"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const expectedRevision = process.env.SOURCE_REVISION ?? process.env.GITHUB_SHA;
if (!expectedRevision || !/^[a-f0-9]{40}$/i.test(expectedRevision)) {
  throw new Error("SOURCE_REVISION or GITHUB_SHA must contain the exact deployment commit.");
}
if (
  config.account_id !== manifest.accountId ||
  config.name !== manifest.workerName ||
  config.vars?.SOURCE_REVISION !== expectedRevision
) {
  throw new Error("Generated Wrangler configuration does not match the deployment manifest.");
}
const d1Binding = config.d1_databases?.find((entry) => entry.binding === "DB");
const r2Binding = config.r2_buckets?.find((entry) => entry.binding === "BACKUPS");
if (
  d1Binding?.database_id !== manifest.d1DatabaseId ||
  d1Binding?.database_name !== manifest.d1Name ||
  r2Binding?.bucket_name !== manifest.r2Name ||
  r2Binding?.jurisdiction !== "eu"
) {
  throw new Error("Generated Wrangler bindings do not match the verified target manifest.");
}

const runReadOnly = (argumentsList, label) =>
  withInfrastructureRetry(() =>
    runWrangler(argumentsList, { accountId: manifest.accountId, label }),
  );

const d1List = parseJsonOutput(
  (await runReadOnly(["d1", "list", "--json"], "D1 inventory preflight")).stdout,
  "D1 inventory",
);
const database = findNamedD1Database(d1List, manifest.d1Name);
if (!database || d1DatabaseId(database) !== manifest.d1DatabaseId) {
  throw new Error("Configured D1 database name and identifier do not exist together.");
}
const d1Info = parseJsonOutput(
  (await runReadOnly(["d1", "info", manifest.d1Name, "--json"], "D1 jurisdiction preflight"))
    .stdout,
  "D1 information",
);
if (findJurisdiction(d1Info) !== "eu") throw new Error("Configured D1 database is not in the EU.");

const r2Info = parseJsonOutput(
  (
    await runReadOnly(
      ["r2", "bucket", "info", manifest.r2Name, "--jurisdiction=eu", "--json"],
      "R2 inventory preflight",
    )
  ).stdout,
  "R2 information",
);
if (findJurisdiction(r2Info) !== "eu") throw new Error("Configured R2 bucket is not in the EU.");

await runReadOnly(["versions", "list", "--config", configPath, "--json"], "Worker preflight");
const secretOutput = await runReadOnly(
  ["secret", "list", "--format", "json", "--config", configPath],
  "Secret inventory preflight",
);
const secretNames = new Set(
  parseJsonOutput(secretOutput.stdout, "Secret inventory").map((entry) => entry.name),
);
const allowedMissingSecrets =
  process.env.PREFLIGHT_ALLOW_MISSING_DEPLOYMENT_SECRET === "true"
    ? new Set(["DEPLOYMENT_BACKUP_TOKEN_HASH"])
    : new Set();
const missingSecrets = requiredCloudflareSecrets.filter(
  (name) => !secretNames.has(name) && !allowedMissingSecrets.has(name),
);
if (missingSecrets.length > 0) {
  throw new Error(`Required Cloudflare secrets are missing: ${missingSecrets.join(", ")}.`);
}

await runReadOnly(
  [
    "deploy",
    "--dry-run",
    "--strict",
    "--autoconfig=false",
    "--x-auto-create=false",
    "--config",
    configPath,
  ],
  "Wrangler dry-run preflight",
);
process.stdout.write(
  `${JSON.stringify({ ok: true, target: profile.target, sourceRevision: expectedRevision })}\n`,
);
