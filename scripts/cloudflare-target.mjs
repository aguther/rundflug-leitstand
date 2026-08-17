import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const requiredCloudflareSecrets = [
  "DEPLOYMENT_BACKUP_TOKEN_HASH",
  "INSTALLATION_RECOVERY_CODE",
  "RESET_SETUP_SIGNING_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];
export const wranglerDeploymentSecrets = requiredCloudflareSecrets.filter(
  (name) => name !== "DEPLOYMENT_BACKUP_TOKEN_HASH",
);
export const compatibilityProfileSecrets = [
  "ADMIN_PIN_HASH",
  "BOOTSTRAP_TOKEN",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const EU_LOCATION_CODES = new Set(["eeur", "weur"]);

function readOption(argumentsList, index, name) {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} benötigt einen Wert.`);
  return value;
}

export function parseCloudflareTargetArguments(argumentsList) {
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const entry = argumentsList[index];
    if (["--dry-run", "--resume", "--confirm-production", "--rotate-secrets"].includes(entry)) {
      flags.add(entry);
      continue;
    }
    if (
      [
        "--target",
        "--worker-name",
        "--d1-name",
        "--r2-name",
        "--app-env",
        "--vapid-subject",
        "--url",
        "--account-id",
      ].includes(entry)
    ) {
      values[entry.slice(2)] = readOption(argumentsList, index, entry);
      index += 1;
      continue;
    }
    throw new Error(`Unbekanntes Argument: ${entry}`);
  }

  const target = values.target;
  if (!target) throw new Error("--target ist erforderlich.");
  assertResourceName(target, "Zielname", 32);
  const workerName = values["worker-name"] ?? `rundflug-leitstand-${target}`;
  const d1Name = values["d1-name"] ?? `${workerName}-db`;
  const r2Name = values["r2-name"] ?? `${workerName}-backups`;
  assertResourceName(workerName, "Worker-Name", 63);
  assertResourceName(d1Name, "D1-Name", 63);
  assertResourceName(r2Name, "R2-Name", 63);

  const appEnv = values["app-env"] ?? "acceptance";
  if (!["acceptance", "production"].includes(appEnv)) {
    throw new Error("--app-env muss acceptance oder production sein.");
  }
  if (appEnv === "production" && !flags.has("--confirm-production")) {
    throw new Error(
      "Produktion benötigt zusätzlich --confirm-production. Der Vorgang wurde nicht gestartet.",
    );
  }

  return {
    target,
    workerName,
    d1Name,
    r2Name,
    appEnv,
    vapidSubject: values["vapid-subject"] ?? null,
    url: values.url ?? null,
    accountId: values["account-id"] ?? null,
    dryRun: flags.has("--dry-run"),
    resume: flags.has("--resume"),
    rotateSecrets: flags.has("--rotate-secrets"),
  };
}

export function assertResourceName(value, label, maximumLength) {
  if (
    value.length < 3 ||
    value.length > maximumLength ||
    !NAME_PATTERN.test(value) ||
    value.includes("--")
  ) {
    throw new Error(
      `${label} muss 3–${maximumLength} Zeichen lang sein und darf nur Kleinbuchstaben, Ziffern und einzelne Bindestriche enthalten.`,
    );
  }
}

export function rateLimitNamespaceId(target, binding) {
  const digest = createHash("sha256").update(`${target}:${binding}`).digest();
  return String((digest.readUInt32BE(0) % 2_000_000_000) + 1);
}

export function generatedConfigPath(profile) {
  return resolve(repositoryRoot, `wrangler.${profile.target}.generated.jsonc`);
}

export function targetManifestPath(profile) {
  return resolve(repositoryRoot, ".wrangler", "targets", `${profile.target}.json`);
}

export function createTargetWranglerConfig(baseConfig, profile, databaseId) {
  const result = structuredClone(baseConfig);
  result.name = profile.workerName;
  result.secrets = { required: [...wranglerDeploymentSecrets] };
  result.vars = {
    ...result.vars,
    APP_ENV: profile.appEnv,
    DATA_JURISDICTION: "eu",
    SOURCE_REVISION:
      process.env.WORKERS_CI_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      result.vars?.SOURCE_REVISION ??
      "unknown",
    ANALYSIS_RETENTION_DAYS: result.vars?.ANALYSIS_RETENTION_DAYS ?? "30",
    PLANNING_DETAIL_RETENTION_HOURS: result.vars?.PLANNING_DETAIL_RETENTION_HOURS ?? "24",
    PLANNING_HISTORY_RETENTION_YEARS: result.vars?.PLANNING_HISTORY_RETENTION_YEARS ?? "5",
  };
  result.d1_databases = [
    {
      binding: "DB",
      database_name: profile.d1Name,
      database_id: databaseId,
      migrations_dir: "apps/worker/migrations",
    },
  ];
  result.r2_buckets = [
    {
      binding: "BACKUPS",
      bucket_name: profile.r2Name,
      jurisdiction: "eu",
    },
  ];
  result.ratelimits = [
    {
      name: "PUBLIC_TICKET_RATE_LIMITER",
      namespace_id: rateLimitNamespaceId(profile.target, "public-ticket"),
      simple: { limit: 30, period: 60 },
    },
    {
      name: "ADMIN_RECOVERY_RATE_LIMITER",
      namespace_id: rateLimitNamespaceId(profile.target, "admin-recovery"),
      simple: { limit: 5, period: 60 },
    },
  ];
  return result;
}

export function cloudflareAccountId(payload, preferredAccountId = null) {
  let accounts = [];
  if (Array.isArray(payload?.accounts)) accounts = payload.accounts;
  else if (Array.isArray(payload?.memberships)) {
    accounts = payload.memberships.map((entry) => entry.account ?? entry);
  }
  const accountIds = accounts
    .map((entry) => entry?.id)
    .filter((entry) => typeof entry === "string" && entry.length > 0);
  const requested = preferredAccountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? null;
  if (requested) {
    if (!accountIds.includes(requested)) {
      throw new Error("Der angegebene Cloudflare-Account gehört nicht zur aktuellen Anmeldung.");
    }
    return requested;
  }
  if (accountIds.length !== 1) {
    throw new Error(
      "Die Anmeldung gehört zu mehreren Cloudflare-Accounts. Gib den Zielaccount mit --account-id an.",
    );
  }
  return accountIds[0];
}

export function findNamedD1Database(payload, name) {
  const entries = Array.isArray(payload) ? payload : (payload?.result ?? []);
  return entries.find((entry) => entry.name === name || entry.database_name === name) ?? null;
}

export function d1DatabaseId(entry) {
  return entry?.uuid ?? entry?.id ?? entry?.database_id ?? null;
}

export function findJurisdiction(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.jurisdiction === "string") return payload.jurisdiction.toLowerCase();
  if (
    typeof payload.location === "string" &&
    EU_LOCATION_CODES.has(payload.location.toLowerCase())
  ) {
    return "eu";
  }
  for (const value of Object.values(payload)) {
    const nested = findJurisdiction(value);
    if (nested) return nested;
  }
  return null;
}

export function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} hat keine lesbare JSON-Antwort geliefert.`);
  }
}

export function deploymentUrl(output) {
  return output.match(/https:\/\/[a-z0-9.-]+(?:workers\.dev|pages\.dev)(?:\/\S*)?/i)?.[0] ?? null;
}
