import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  generatedConfigPath,
  parseCloudflareTargetArguments,
  parseJsonOutput,
  repositoryRoot,
  requiredCloudflareSecrets,
  targetManifestPath,
} from "./cloudflare-target.mjs";
import { waitForExpectedRevision } from "./lib/deployment-verification.mjs";

const profile = parseCloudflareTargetArguments(process.argv.slice(2));
const wrangler = resolve(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const configPath = generatedConfigPath(profile);
const manifest = JSON.parse(await readFile(targetManifestPath(profile), "utf8"));
if (profile.accountId && profile.accountId !== manifest.accountId) {
  throw new Error("Der angegebene Cloudflare-Account weicht vom Zielmanifest ab.");
}
const baseUrl = (profile.url ?? manifest.deploymentUrl)?.replace(/\/$/, "");
if (!baseUrl) throw new Error("--url fehlt und das Zielmanifest enthält keine Deployment-URL.");

function runWrangler(argumentsList) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wrangler, ...argumentsList], {
      cwd: repositoryRoot,
      env: manifest.accountId
        ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: manifest.accountId }
        : process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else
        reject(
          new Error(`Wrangler-Prüfung fehlgeschlagen: ${argumentsList.slice(0, 3).join(" ")}`),
        );
    });
  });
}

const migrationOutput = await runWrangler([
  "d1",
  "migrations",
  "list",
  "DB",
  "--remote",
  "--config",
  configPath,
]);
if (!/No migrations to apply/i.test(migrationOutput)) {
  throw new Error("Das Ziel besitzt noch ausstehende D1-Migrationen.");
}
const secretOutput = await runWrangler([
  "secret",
  "list",
  "--format",
  "json",
  "--config",
  configPath,
]);
const secretNames = new Set(
  parseJsonOutput(secretOutput, "Secret-Liste").map((entry) => entry.name),
);
const missingSecrets = requiredCloudflareSecrets.filter((name) => !secretNames.has(name));
if (missingSecrets.length > 0) {
  throw new Error(`Cloudflare-Secrets fehlen: ${missingSecrets.join(", ")}`);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "cache-control": "no-store" },
  });
  if (!response.ok) throw new Error(`${path} liefert HTTP ${response.status}.`);
  return response.json();
}

const expectedRevision = process.env.SOURCE_REVISION ?? process.env.GITHUB_SHA;
const health = await getJson("/api/health");
const meta = expectedRevision
  ? await waitForExpectedRevision({
      baseUrl,
      expectedRevision,
      onRetry: ({ attempt, delayMs, lastObservedRevision, error }) => {
        const observation = error
          ? `request failed: ${String(error)}`
          : `observed revision ${lastObservedRevision ?? "unknown"}`;
        process.stderr.write(
          `Deployment revision is not stable after attempt ${attempt} (${observation}); retrying in ${delayMs} ms.\n`,
        );
      },
    })
  : await getJson("/api/meta");
const setup = await getJson("/api/setup/status");
const push = await getJson("/api/public/push/config");
if (
  health.applicationVersion !== "1.12.0" ||
  health.requirementsVersion !== "1.12.0" ||
  meta.applicationVersion !== "1.12.0" ||
  meta.requirementsVersion !== "1.12.0"
) {
  throw new Error("Healthcheck meldet nicht den konsistenten Release 1.12.0.");
}
if (meta.dataJurisdiction !== "eu") throw new Error("/api/meta meldet keine EU-Jurisdiktion.");
if (!/^[0-9a-f]{40}$/i.test(meta.sourceRevision ?? "")) {
  throw new Error("/api/meta meldet keine eindeutige Deployment-Revision.");
}
if (expectedRevision && meta.sourceRevision !== expectedRevision) {
  throw new Error(
    `/api/meta meldet Revision ${meta.sourceRevision}, erwartet wurde ${expectedRevision}.`,
  );
}
if (!push.publicKey)
  throw new Error("Web-Push-Konfiguration enthält keinen öffentlichen Schlüssel.");

process.stdout.write(
  `${JSON.stringify(
    {
      target: profile.target,
      baseUrl,
      health: "ok",
      version: health.applicationVersion,
      jurisdiction: meta.dataJurisdiction,
      sourceRevision: meta.sourceRevision,
      setupRequired: setup.setupRequired,
      push: "configured",
      migrations: "current",
      secrets: "complete",
    },
    null,
    2,
  )}\n`,
);
