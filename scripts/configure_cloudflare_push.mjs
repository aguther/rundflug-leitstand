import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  findMissingVapidSecrets,
  generateVapidKeyPair,
  readVapidSubjectArgument,
  validateVapidSubject,
} from "./vapid-keys.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");

async function putSecrets(values) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [wrangler, "secret", "bulk", "--config", "wrangler.jsonc"],
      { cwd: root, stdio: ["pipe", "inherit", "inherit"], windowsHide: true },
    );
    child.stdin.end(JSON.stringify(values));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error("Die Web-Push-Secrets konnten nicht vollständig gesetzt werden."));
    });
  });
}

async function listSecrets() {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [wrangler, "secret", "list", "--format", "json", "--config", "wrangler.jsonc"],
      { cwd: root, stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error("Die gesetzten Secret-Namen konnten nicht geprüft werden."));
        return;
      }
      try {
        resolvePromise(JSON.parse(output));
      } catch {
        reject(new Error("Wrangler hat keine lesbare Secret-Liste zurückgegeben."));
      }
    });
  });
}

let subject = readVapidSubjectArgument(process.argv.slice(2));
if (subject === null) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Dieser Befehl benötigt ein interaktives Terminal oder --subject mit einer öffentlichen Betreiber-URL.",
    );
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    subject = validateVapidSubject(
      await prompt.question(
        "Betreiberkontakt für Web-Push (mailto:adresse@example.de oder https://…): ",
      ),
    );
  } finally {
    prompt.close();
  }
}

process.stdout.write("Erzeuge ein neues P-256-Schlüsselpaar und übertrage drei Secrets …\n");
const pair = generateVapidKeyPair();
try {
  await putSecrets({
    VAPID_PUBLIC_KEY: pair.publicKey,
    VAPID_PRIVATE_KEY: pair.privateKey,
    VAPID_SUBJECT: subject,
  });
} finally {
  pair.privateKey = "";
}
const missingSecrets = findMissingVapidSecrets(await listSecrets());
if (missingSecrets.length > 0) {
  throw new Error(`Cloudflare meldet noch fehlende Web-Push-Secrets: ${missingSecrets.join(", ")}`);
}
process.stdout.write(
  "Web-Push-Secrets wurden gesetzt und ihre Namen über Cloudflare bestätigt. " +
    "Private Schlüssel wurden weder angezeigt noch gespeichert.\n" +
    "Nach Abschluss des Cloudflare-Deployments muss /api/public/push/config mit HTTP 200 antworten.\n",
);
