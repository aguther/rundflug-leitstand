import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createRecreatedTargetState,
  createRecreationPlan,
  expectedRecreationConfirmation,
  parseD1RecreationArguments,
  validateRecreationManifest,
  verifyRemoteInventory,
} from "./cloudflare-d1-recreation.mjs";
import {
  cloudflareAccountId,
  d1DatabaseId,
  findNamedD1Database,
  generatedConfigPath,
  parseJsonOutput,
  repositoryRoot,
  targetManifestPath,
} from "./cloudflare-target.mjs";

const options = parseD1RecreationArguments(process.argv.slice(2));
const targetReference = { target: options.target };
const manifestPath = targetManifestPath(targetReference);
const configPath = generatedConfigPath(targetReference);
const manifest = validateRecreationManifest(
  JSON.parse(await readFile(manifestPath, "utf8")),
  options.target,
);
const wrangler = resolve(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
let accountId = manifest.accountId;

function runWrangler(argumentsList) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wrangler, ...argumentsList], {
      cwd: repositoryRoot,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else
        reject(new Error(`Wrangler-Befehl fehlgeschlagen: ${argumentsList.slice(0, 3).join(" ")}`));
    });
  });
}

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

const whoami = parseJsonOutput(await runWrangler(["whoami", "--json"]), "Cloudflare-Anmeldung");
accountId = cloudflareAccountId(whoami, options.accountId ?? manifest.accountId);
if (accountId !== manifest.accountId) {
  throw new Error("Die aktuelle Anmeldung gehört nicht zum Account des Zielmanifests.");
}

const [d1List, d1Info, r2Info] = await Promise.all([
  runWrangler(["d1", "list", "--json"]),
  runWrangler(["d1", "info", manifest.d1Name, "--json"]),
  runWrangler(["r2", "bucket", "info", manifest.r2Name, "--jurisdiction=eu", "--json"]),
]);
verifyRemoteInventory(
  manifest,
  parseJsonOutput(d1List, "D1-Liste"),
  parseJsonOutput(d1Info, "D1-Info"),
  parseJsonOutput(r2Info, "R2-Info"),
);

process.stdout.write(`${JSON.stringify(createRecreationPlan(manifest), null, 2)}\n`);
const expectedConfirmation = expectedRecreationConfirmation(manifest);
if (!options.confirmation) {
  process.stdout.write(
    `Dry-Run abgeschlossen. Für den irreversiblen D1-Neuaufbau erneut mit --confirm ${expectedConfirmation} starten.\n`,
  );
  process.exit(0);
}
if (options.confirmation !== expectedConfirmation) {
  throw new Error("Die Bestätigung stimmt nicht exakt mit dem ausgewählten D1-Ziel überein.");
}

if (!manifest.d1RecreationPending) {
  await runWrangler(["d1", "delete", manifest.d1Name, "--skip-confirmation"]);
  await runWrangler(["d1", "create", manifest.d1Name, "--jurisdiction=eu"]);
}
const recreatedList = parseJsonOutput(await runWrangler(["d1", "list", "--json"]), "D1-Liste");
const recreatedDatabase = findNamedD1Database(recreatedList, manifest.d1Name);
const recreatedDatabaseId = d1DatabaseId(recreatedDatabase);
if (!recreatedDatabaseId || recreatedDatabaseId === manifest.d1DatabaseId) {
  if (!manifest.d1RecreationPending || recreatedDatabaseId !== manifest.d1DatabaseId) {
    throw new Error("Die neue D1-ID konnte nach dem Neuaufbau nicht eindeutig bestätigt werden.");
  }
}
if (!manifest.d1RecreationPending) {
  await writeJsonAtomically(manifestPath, {
    ...manifest,
    d1DatabaseId: recreatedDatabaseId,
    d1RecreationPending: true,
    recreatedAt: new Date().toISOString(),
  });
}
const recreatedInfo = parseJsonOutput(
  await runWrangler(["d1", "info", manifest.d1Name, "--json"]),
  "D1-Info",
);
verifyRemoteInventory(
  { ...manifest, d1DatabaseId: recreatedDatabaseId },
  recreatedList,
  recreatedInfo,
  parseJsonOutput(r2Info, "R2-Info"),
);

const baseConfig = JSON.parse(await readFile(resolve(repositoryRoot, "wrangler.jsonc"), "utf8"));
const recreatedState = createRecreatedTargetState(
  baseConfig,
  { ...manifest, d1DatabaseId: recreatedDatabaseId },
  recreatedDatabaseId,
);
await writeJsonAtomically(configPath, recreatedState.config);
await runWrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", configPath]);
await writeJsonAtomically(manifestPath, recreatedState.manifest);
process.stdout.write(
  `${JSON.stringify({ target: manifest.target, d1: manifest.d1Name, migrations: "all-pending", status: "recreated" }, null, 2)}\n`,
);
