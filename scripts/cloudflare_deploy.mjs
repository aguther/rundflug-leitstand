import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generatedConfigPath,
  parseCloudflareTargetArguments,
  parseJsonOutput,
  repositoryRoot,
  targetManifestPath,
} from "./cloudflare-target.mjs";
import { runWrangler } from "./lib/cloudflare-command.mjs";
import { waitForExpectedRevision } from "./lib/deployment-verification.mjs";
import {
  isTransientInfrastructureFailure,
  withInfrastructureRetry,
} from "./lib/infrastructure-retry.mjs";
import { loadMigrationSafety, pendingOnlineMigrations } from "./lib/migration-safety.mjs";

export function extractD1Rows(payload) {
  const executions = Array.isArray(payload) ? payload : [payload];
  return executions.flatMap((execution) =>
    Array.isArray(execution?.results) ? execution.results : [],
  );
}

export function findTimeTravelBookmark(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.bookmark === "string" && payload.bookmark.length > 0) return payload.bookmark;
  for (const value of Object.values(payload)) {
    const bookmark = findTimeTravelBookmark(value);
    if (bookmark) return bookmark;
  }
  return null;
}

export async function withDeploymentSecretsFile(deploymentToken, operation) {
  const directory = await mkdtemp(join(tmpdir(), "rundflug-deployment-secrets-"));
  const secretsFilePath = join(directory, "secrets.json");
  const deploymentTokenHash = createHash("sha256").update(deploymentToken).digest("hex");
  try {
    await writeFile(
      secretsFilePath,
      JSON.stringify({ DEPLOYMENT_BACKUP_TOKEN_HASH: deploymentTokenHash }),
      { encoding: "utf8", mode: 0o600 },
    );
    return await operation(secretsFilePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const profile = parseCloudflareTargetArguments(argumentsList);
  const configPath = generatedConfigPath(profile);
  const manifest = JSON.parse(await readFile(targetManifestPath(profile), "utf8"));
  const sourceRevision = process.env.SOURCE_REVISION ?? process.env.GITHUB_SHA;
  const deploymentToken = process.env.DEPLOYMENT_BACKUP_TOKEN;
  const baseUrl = (process.env.CLOUDFLARE_DEPLOYMENT_URL ?? manifest.deploymentUrl)?.replace(
    /\/$/,
    "",
  );
  if (!sourceRevision || !/^[a-f0-9]{40}$/i.test(sourceRevision)) {
    throw new Error("SOURCE_REVISION or GITHUB_SHA must contain the exact deployment commit.");
  }
  if (!deploymentToken || deploymentToken.length < 32) {
    throw new Error("DEPLOYMENT_BACKUP_TOKEN must contain at least 32 characters.");
  }
  if (!baseUrl)
    throw new Error("CLOUDFLARE_DEPLOYMENT_URL is required for deployment verification.");

  const migrationFiles = (await readdir(`${repositoryRoot}/apps/worker/migrations`))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  const migrationSafety = await loadMigrationSafety(repositoryRoot, migrationFiles);
  const wranglerOptions = { accountId: manifest.accountId };
  const commonD1Arguments = ["--remote", "--config", configPath, "--x-provision=false"];

  async function appliedMigrationNames() {
    const result = await runWrangler(
      [
        "d1",
        "execute",
        "DB",
        "--command",
        "SELECT name FROM d1_migrations ORDER BY id",
        "--json",
        ...commonD1Arguments,
      ],
      { ...wranglerOptions, label: "Applied migration query" },
    );
    return extractD1Rows(parseJsonOutput(result.stdout, "Applied migrations"))
      .map((row) => row.name)
      .filter((name) => typeof name === "string");
  }

  async function requestPreDeploymentBackup(bookmark) {
    await withInfrastructureRetry(async () => {
      let response;
      try {
        response = await fetch(`${baseUrl}/api/internal/deployment-backups`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${deploymentToken}`,
            "content-type": "application/json",
            "idempotency-key": sourceRevision,
          },
          body: JSON.stringify({ sourceRevision, bookmark }),
        });
      } catch (error) {
        throw new Error(`Deployment backup fetch failed: ${String(error)}`);
      }
      if (!response.ok) {
        throw new Error(`Deployment backup endpoint returned HTTP ${response.status}.`);
      }
      const result = await response.json();
      if (
        result.sourceRevision !== sourceRevision ||
        !/^[a-f0-9]{64}$/.test(result.checksum ?? "")
      ) {
        throw new Error("Deployment backup receipt is invalid.");
      }
    });
  }

  async function applyPendingMigrations() {
    let applied = await appliedMigrationNames();
    const pending = pendingOnlineMigrations(migrationSafety, applied);
    if (pending.length === 0) return [];

    const bookmarkResult = await withInfrastructureRetry(() =>
      runWrangler(["d1", "time-travel", "info", "DB", "--json", "--config", configPath], {
        ...wranglerOptions,
        label: "D1 Time Travel bookmark",
      }),
    );
    const bookmark = findTimeTravelBookmark(
      parseJsonOutput(bookmarkResult.stdout, "D1 Time Travel information"),
    );
    if (!bookmark) throw new Error("D1 Time Travel did not return a recovery bookmark.");
    await requestPreDeploymentBackup(bookmark);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await runWrangler(["d1", "migrations", "apply", "DB", "--yes", ...commonD1Arguments], {
          ...wranglerOptions,
          label: "Online-safe D1 migration",
        });
        break;
      } catch (error) {
        if (!isTransientInfrastructureFailure(error) || attempt === 3) throw error;
        applied = await appliedMigrationNames();
        if (pendingOnlineMigrations(migrationSafety, applied).length === 0) break;
        const delayMs = 1_000 * 2 ** (attempt - 1);
        process.stderr.write(
          `Transient migration failure after attempt ${attempt}; retrying in ${delayMs} ms.\n`,
        );
        await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
      }
    }

    applied = await appliedMigrationNames();
    const remaining = pendingOnlineMigrations(migrationSafety, applied);
    if (remaining.length > 0) {
      throw new Error(
        `Migrations remain unapplied: ${remaining.map((entry) => entry.file).join(", ")}.`,
      );
    }
    return pending.map((entry) => entry.file);
  }

  async function deployedRevisionMatches() {
    try {
      const verificationUrl = new URL("/api/meta", `${baseUrl}/`);
      verificationUrl.searchParams.set(
        "deployment-verification",
        `${sourceRevision}-${Date.now()}`,
      );
      const response = await fetch(verificationUrl, {
        headers: { "cache-control": "no-store" },
      });
      if (!response.ok) return false;
      return (await response.json()).sourceRevision === sourceRevision;
    } catch {
      return false;
    }
  }

  async function deployRevision(secretsFilePath) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await runWrangler(
          [
            "deploy",
            "--strict",
            "--autoconfig=false",
            "--x-auto-create=false",
            "--secrets-file",
            secretsFilePath,
            "--config",
            configPath,
          ],
          { ...wranglerOptions, label: "Cloudflare deployment" },
        );
        return;
      } catch (error) {
        if (!isTransientInfrastructureFailure(error) || attempt === 3) throw error;
        if (await deployedRevisionMatches()) return;
        const delayMs = 1_000 * 2 ** (attempt - 1);
        process.stderr.write(
          `Transient deployment failure after attempt ${attempt}; retrying in ${delayMs} ms.\n`,
        );
        await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
      }
    }
  }

  const appliedMigrations = await applyPendingMigrations();
  await withDeploymentSecretsFile(deploymentToken, async (secretsFilePath) => {
    await deployRevision(secretsFilePath);
    await waitForExpectedRevision({
      baseUrl,
      expectedRevision: sourceRevision,
      onRetry: ({ attempt, delayMs, lastObservedRevision, error }) => {
        const observation = error
          ? `request failed: ${String(error)}`
          : `observed revision ${lastObservedRevision ?? "unknown"}`;
        process.stderr.write(
          `Deployment revision is not stable after attempt ${attempt} (${observation}); retrying in ${delayMs} ms.\n`,
        );
      },
    });
  });
  process.stdout.write(
    `${JSON.stringify({ ok: true, sourceRevision, appliedMigrations, deployment: "verified" })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
