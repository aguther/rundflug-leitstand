import {
  assertResourceName,
  createTargetWranglerConfig,
  d1DatabaseId,
  findJurisdiction,
  findNamedD1Database,
} from "./cloudflare-target.mjs";

export function parseD1RecreationArguments(argumentsList) {
  const result = { target: null, accountId: null, confirmation: null };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    if (!["--target", "--account-id", "--confirm"].includes(option)) {
      throw new Error(`Unbekanntes Argument: ${option}`);
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} benötigt einen Wert.`);
    if (option === "--target") result.target = value;
    if (option === "--account-id") result.accountId = value;
    if (option === "--confirm") result.confirmation = value;
    index += 1;
  }
  if (!result.target) throw new Error("--target ist erforderlich.");
  assertResourceName(result.target, "Zielname", 32);
  return result;
}

export function validateRecreationManifest(manifest, target) {
  const required = [
    "target",
    "accountId",
    "workerName",
    "d1Name",
    "d1DatabaseId",
    "r2Name",
    "appEnv",
    "jurisdiction",
  ];
  const missing = required.filter(
    (key) => typeof manifest?.[key] !== "string" || manifest[key].trim().length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`Das Zielmanifest ist unvollständig: ${missing.join(", ")}.`);
  }
  if (manifest.target !== target) throw new Error("Das Zielmanifest gehört zu einem anderen Ziel.");
  if (manifest.jurisdiction.toLowerCase() !== "eu") {
    throw new Error("Der D1-Neuaufbau ist ausschließlich für EU-Ziele freigegeben.");
  }
  assertResourceName(manifest.workerName, "Worker-Name", 63);
  assertResourceName(manifest.d1Name, "D1-Name", 63);
  assertResourceName(manifest.r2Name, "R2-Name", 63);
  return manifest;
}

export function expectedRecreationConfirmation(manifest) {
  return `DELETE-${manifest.d1Name}`;
}

export function createRecreationPlan(manifest) {
  return {
    account: manifest.accountId,
    target: manifest.target,
    worker: manifest.workerName,
    d1: { name: manifest.d1Name, id: manifest.d1DatabaseId },
    r2: manifest.r2Name,
    jurisdiction: "eu",
    migrations: "all-pending",
    remoteSeeds: "none",
    pendingRecreation: manifest.d1RecreationPending === true,
  };
}

export function verifyRemoteInventory(manifest, d1Payload, d1InfoPayload, r2InfoPayload) {
  const database = findNamedD1Database(d1Payload, manifest.d1Name);
  if (!database || d1DatabaseId(database) !== manifest.d1DatabaseId) {
    throw new Error("Remote-D1 und Zielmanifest stimmen nicht eindeutig überein.");
  }
  const d1Jurisdiction = findJurisdiction(d1InfoPayload);
  const r2Jurisdiction = findJurisdiction(r2InfoPayload);
  if (d1Jurisdiction !== "eu" || r2Jurisdiction !== "eu") {
    throw new Error("D1 und R2 müssen nachweislich in der EU-Jurisdiktion liegen.");
  }
}

export function createRecreatedTargetState(baseConfig, manifest, databaseId) {
  const profile = {
    target: manifest.target,
    workerName: manifest.workerName,
    d1Name: manifest.d1Name,
    r2Name: manifest.r2Name,
    appEnv: manifest.appEnv,
  };
  const config = createTargetWranglerConfig(baseConfig, profile, databaseId);
  config.account_id = manifest.accountId;
  return {
    config,
    manifest: {
      ...manifest,
      d1DatabaseId: databaseId,
      jurisdiction: "eu",
      d1RecreationPending: false,
      recreatedAt: new Date().toISOString(),
    },
  };
}
