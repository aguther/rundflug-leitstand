import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createTargetWranglerConfig,
  generatedConfigPath,
  parseCloudflareTargetArguments,
  repositoryRoot,
  requiredCloudflareSecrets,
  targetManifestPath,
} from "./cloudflare-target.mjs";

const target = process.env.CLOUDFLARE_TARGET;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (!target || !accountId || !databaseId) {
  throw new Error(
    "CLOUDFLARE_TARGET, CLOUDFLARE_ACCOUNT_ID und CLOUDFLARE_D1_DATABASE_ID sind erforderlich.",
  );
}

const argumentsList = ["--target", target];
for (const [option, value] of [
  ["--worker-name", process.env.CLOUDFLARE_WORKER_NAME],
  ["--d1-name", process.env.CLOUDFLARE_D1_NAME],
  ["--r2-name", process.env.CLOUDFLARE_R2_NAME],
  ["--app-env", process.env.CLOUDFLARE_APP_ENV],
]) {
  if (value) argumentsList.push(option, value);
}
if (process.env.CLOUDFLARE_APP_ENV === "production") {
  argumentsList.push("--confirm-production");
}

const profile = parseCloudflareTargetArguments(argumentsList);
const baseConfig = JSON.parse(await readFile(resolve(repositoryRoot, "wrangler.jsonc"), "utf8"));
const config = createTargetWranglerConfig(baseConfig, profile, databaseId);
config.account_id = accountId;
const output = generatedConfigPath(profile);
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, "utf8");
const manifestPath = targetManifestPath(profile);
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      target: profile.target,
      accountId,
      workerName: profile.workerName,
      d1Name: profile.d1Name,
      d1DatabaseId: databaseId,
      r2Name: profile.r2Name,
      appEnv: profile.appEnv,
      jurisdiction: "eu",
      requiredSecrets: [...requiredCloudflareSecrets],
      configPath: output,
      deploymentUrl: process.env.CLOUDFLARE_DEPLOYMENT_URL ?? null,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write(`${output}\n`);
