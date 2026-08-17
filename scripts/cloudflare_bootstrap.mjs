import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  cloudflareAccountId,
  createTargetWranglerConfig,
  d1DatabaseId,
  deploymentUrl,
  findJurisdiction,
  findNamedD1Database,
  generatedConfigPath,
  parseCloudflareTargetArguments,
  parseJsonOutput,
  repositoryRoot,
  requiredCloudflareSecrets,
  targetManifestPath,
} from "./cloudflare-target.mjs";
import { generateVapidKeyPair, validateVapidSubject } from "./vapid-keys.mjs";

const profile = parseCloudflareTargetArguments(process.argv.slice(2));
const wrangler = resolve(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const configPath = generatedConfigPath(profile);
const manifestPath = targetManifestPath(profile);
let selectedAccountId = null;

function run(command, argumentsList, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: repositoryRoot,
      env: selectedAccountId
        ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: selectedAccountId }
        : process.env,
      windowsHide: true,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (options.echo !== false) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (options.echo !== false) process.stderr.write(chunk);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || options.allowFailure) {
        resolvePromise({ code, stdout, stderr });
      } else {
        reject(new Error(options.errorMessage ?? `Befehl fehlgeschlagen: ${argumentsList[0]}`));
      }
    });
  });
}

function runWrangler(argumentsList, options) {
  return run(process.execPath, [wrangler, ...argumentsList], options);
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

async function writeManifest(values) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
}

function publicPlan() {
  return {
    target: profile.target,
    environment: profile.appEnv,
    worker: profile.workerName,
    d1: profile.d1Name,
    r2: profile.r2Name,
    jurisdiction: "eu",
    generatedConfig: configPath,
    actions: [
      "Cloudflare-Anmeldung prüfen",
      "D1 und R2 sicher erkennen oder neu erstellen",
      "accountbezogene Wrangler-Konfiguration erzeugen",
      "Secrets sicher erzeugen und übertragen",
      "D1-Migrationen anwenden",
      "Weboberfläche und Worker deployen",
    ],
  };
}

process.stdout.write(`${JSON.stringify(publicPlan(), null, 2)}\n`);
if (profile.dryRun) {
  process.stdout.write("Dry-Run abgeschlossen: Es wurden keine Cloudflare-Ressourcen verändert.\n");
  process.exit(0);
}
if (!profile.vapidSubject) {
  throw new Error("--vapid-subject ist für den vollständigen Neuaufbau erforderlich.");
}
const vapidSubject = validateVapidSubject(profile.vapidSubject);

const existingManifest = await readManifest();
if (existingManifest && !profile.resume) {
  throw new Error(
    `Das Ziel ${profile.target} wurde bereits vorbereitet. Verwende --resume für eine sichere Fortsetzung.`,
  );
}
if (
  existingManifest &&
  (existingManifest.workerName !== profile.workerName ||
    existingManifest.d1Name !== profile.d1Name ||
    existingManifest.r2Name !== profile.r2Name ||
    existingManifest.appEnv !== profile.appEnv)
) {
  throw new Error("Die angegebenen Namen weichen vom vorhandenen Zielmanifest ab.");
}

const whoami = await runWrangler(["whoami", "--json"], {
  echo: false,
  errorMessage: "Cloudflare-Anmeldung konnte nicht bestätigt werden.",
});
selectedAccountId = cloudflareAccountId(
  parseJsonOutput(whoami.stdout, "Cloudflare-Anmeldung"),
  profile.accountId ?? existingManifest?.accountId ?? null,
);
if (existingManifest?.accountId && existingManifest.accountId !== selectedAccountId) {
  throw new Error("Das vorhandene Zielmanifest gehört zu einem anderen Cloudflare-Account.");
}

const d1ListResult = await runWrangler(["d1", "list", "--json"], { echo: false });
let database = findNamedD1Database(
  parseJsonOutput(d1ListResult.stdout, "D1-Liste"),
  profile.d1Name,
);
if (database && !profile.resume && !existingManifest) {
  throw new Error(
    `D1 ${profile.d1Name} existiert bereits. Verwende --resume nur nach bewusster Prüfung des Ziels.`,
  );
}
if (!database) {
  await runWrangler(["d1", "create", profile.d1Name, "--jurisdiction=eu"], {
    errorMessage: `D1 ${profile.d1Name} konnte nicht angelegt werden.`,
  });
  const refreshed = await runWrangler(["d1", "list", "--json"], { echo: false });
  database = findNamedD1Database(parseJsonOutput(refreshed.stdout, "D1-Liste"), profile.d1Name);
}
const databaseId = d1DatabaseId(database);
if (!databaseId) throw new Error(`D1-ID für ${profile.d1Name} konnte nicht bestimmt werden.`);
const d1InfoResult = await runWrangler(["d1", "info", profile.d1Name, "--json"], { echo: false });
const d1Jurisdiction = findJurisdiction(parseJsonOutput(d1InfoResult.stdout, "D1-Info"));
if (d1Jurisdiction && d1Jurisdiction !== "eu") {
  throw new Error(`D1 ${profile.d1Name} liegt nicht in der EU-Jurisdiktion.`);
}

const r2Info = await runWrangler(
  ["r2", "bucket", "info", profile.r2Name, "--jurisdiction=eu", "--json"],
  { echo: false, allowFailure: true },
);
if (r2Info.code === 0 && !profile.resume && !existingManifest) {
  throw new Error(
    `R2 ${profile.r2Name} existiert bereits. Verwende --resume nur nach bewusster Prüfung des Ziels.`,
  );
}
if (r2Info.code !== 0) {
  await runWrangler(["r2", "bucket", "create", profile.r2Name, "--jurisdiction=eu"], {
    errorMessage: `R2 ${profile.r2Name} konnte nicht angelegt werden.`,
  });
} else {
  const r2Jurisdiction = findJurisdiction(parseJsonOutput(r2Info.stdout, "R2-Info"));
  if (r2Jurisdiction && r2Jurisdiction !== "eu") {
    throw new Error(`R2 ${profile.r2Name} liegt nicht in der EU-Jurisdiktion.`);
  }
}

const baseConfig = JSON.parse(await readFile(resolve(repositoryRoot, "wrangler.jsonc"), "utf8"));
const generatedConfig = createTargetWranglerConfig(baseConfig, profile, databaseId);
const sourceRevision = await run("git", ["rev-parse", "HEAD"], {
  echo: false,
  errorMessage: "Die auszurollende Git-Revision konnte nicht bestimmt werden.",
});
generatedConfig.vars.SOURCE_REVISION = sourceRevision.stdout.trim();
generatedConfig.account_id = selectedAccountId;
await writeFile(configPath, `${JSON.stringify(generatedConfig, null, 2)}\n`, "utf8");
await writeManifest({
  target: profile.target,
  accountId: selectedAccountId,
  workerName: profile.workerName,
  d1Name: profile.d1Name,
  d1DatabaseId: databaseId,
  r2Name: profile.r2Name,
  appEnv: profile.appEnv,
  jurisdiction: "eu",
  requiredSecrets: [...requiredCloudflareSecrets],
  configPath,
  deploymentUrl: existingManifest?.deploymentUrl ?? null,
});

const secretList = await runWrangler(
  ["secret", "list", "--format", "json", "--config", configPath],
  { echo: false, allowFailure: true },
);
const configuredSecretNames =
  secretList.code === 0
    ? new Set(parseJsonOutput(secretList.stdout, "Secret-Liste").map((entry) => entry.name))
    : new Set();
const configuredRequiredSecrets = requiredCloudflareSecrets.filter((name) =>
  configuredSecretNames.has(name),
);
if (
  configuredRequiredSecrets.length > 0 &&
  configuredRequiredSecrets.length < requiredCloudflareSecrets.length &&
  !profile.rotateSecrets
) {
  throw new Error(
    "Das Ziel besitzt nur einen Teil der benötigten Secrets. Prüfe das Ziel und verwende erst dann bewusst --rotate-secrets.",
  );
}

let installationRecoveryCode = null;
if (configuredRequiredSecrets.length === 0 || profile.rotateSecrets) {
  const deploymentBackupToken = process.env.DEPLOYMENT_BACKUP_TOKEN;
  if (!deploymentBackupToken || deploymentBackupToken.length < 32) {
    throw new Error(
      "DEPLOYMENT_BACKUP_TOKEN must be provided securely and contain at least 32 characters.",
    );
  }
  installationRecoveryCode = randomBytes(24).toString("base64url");
  const resetSigningKey = randomBytes(32).toString("base64url");
  const vapid = generateVapidKeyPair();
  try {
    await runWrangler(["secret", "bulk", "--config", configPath], {
      input: JSON.stringify({
        DEPLOYMENT_BACKUP_TOKEN_HASH: createHash("sha256")
          .update(deploymentBackupToken)
          .digest("hex"),
        INSTALLATION_RECOVERY_CODE: installationRecoveryCode,
        RESET_SETUP_SIGNING_KEY: resetSigningKey,
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: vapidSubject,
      }),
      echo: true,
      errorMessage: "Die Cloudflare-Secrets konnten nicht vollständig gesetzt werden.",
    });
  } finally {
    vapid.privateKey = "";
  }
}

await runWrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", configPath], {
  errorMessage: "Die D1-Migrationen konnten nicht angewendet werden.",
});
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
await run(process.execPath, [npmCli, "run", "build:web"], {
  errorMessage: "Die Weboberfläche konnte nicht gebaut werden.",
});
const deployment = await runWrangler(["deploy", "--config", configPath], {
  errorMessage: "Worker und statische Assets konnten nicht deployt werden.",
});
const deployedUrl = deploymentUrl(`${deployment.stdout}\n${deployment.stderr}`);
await writeManifest({
  ...(await readManifest()),
  deploymentUrl: deployedUrl,
  deployedAt: new Date().toISOString(),
});

if (installationRecoveryCode) {
  process.stdout.write(
    "\nINSTALLATIONS-NOTFALLCODE – JETZT EINMALIG IM PASSWORTSAFE SICHERN\n" +
      `${installationRecoveryCode}\n` +
      "Der Wert wird nicht in einer lokalen Datei gespeichert und kann später nicht aus Cloudflare gelesen werden.\n\n",
  );
}
if (deployedUrl) {
  process.stdout.write(`Ersteinrichtung: ${deployedUrl.replace(/\/$/, "")}/setup\n`);
}
process.stdout.write(
  `Verifikation: npm run cloudflare:verify -- --target ${profile.target}${
    deployedUrl ? "" : " --url https://<worker-domain>"
  }\n`,
);
