import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { generateVapidKeyPair, validateVapidSubject } from "./vapid-keys.mjs";

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

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("Dieser Befehl benötigt ein interaktives Terminal.");
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
let subject;
try {
  subject = validateVapidSubject(
    await prompt.question(
      "Betreiberkontakt für Web-Push (mailto:adresse@example.de oder https://…): ",
    ),
  );
} finally {
  prompt.close();
}

process.stdout.write("Erzeuge ein neues P-256-Schlüsselpaar und übertrage drei Secrets …\n");
const pair = generateVapidKeyPair();
await putSecrets({
  VAPID_PUBLIC_KEY: pair.publicKey,
  VAPID_PRIVATE_KEY: pair.privateKey,
  VAPID_SUBJECT: subject,
});
pair.privateKey = "";
process.stdout.write(
  "Web-Push-Secrets wurden gesetzt. Private Schlüssel wurden weder angezeigt noch gespeichert.\n",
);
