import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  generatedConfigPath,
  parseCloudflareTargetArguments,
  targetManifestPath,
} from "./cloudflare-target.mjs";
import { runWrangler } from "./lib/cloudflare-command.mjs";
import { withInfrastructureRetry } from "./lib/infrastructure-retry.mjs";

const profile = parseCloudflareTargetArguments(process.argv.slice(2));
const token = process.env.DEPLOYMENT_BACKUP_TOKEN;
if (!token || token.length < 32) {
  throw new Error("DEPLOYMENT_BACKUP_TOKEN must contain at least 32 characters.");
}
const manifest = JSON.parse(await readFile(targetManifestPath(profile), "utf8"));
const tokenHash = createHash("sha256").update(token).digest("hex");
await withInfrastructureRetry(
  () =>
    runWrangler(
      ["secret", "put", "DEPLOYMENT_BACKUP_TOKEN_HASH", "--config", generatedConfigPath(profile)],
      {
        accountId: manifest.accountId,
        input: tokenHash,
        label: "Deployment backup credential synchronization",
      },
    ),
  {
    onRetry: ({ attempt, delayMs }) =>
      process.stderr.write(
        `Transient secret synchronization failure after attempt ${attempt}; retrying in ${delayMs} ms.\n`,
      ),
  },
);
process.stdout.write("Deployment backup credential synchronized.\n");
