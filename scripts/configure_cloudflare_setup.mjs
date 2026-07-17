import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Dieser Befehl benötigt ein interaktives Terminal.");
  }
  return new Promise((resolvePromise, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        finish();
        reject(new Error("Abgebrochen."));
        return;
      }
      if (text === "\r" || text === "\n") {
        finish();
        resolvePromise(value);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if (/^[\x20-\x7e]+$/.test(text)) value += text;
    };
    process.stdin.on("data", onData);
  });
}

async function putSecret(name, value) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [wrangler, "secret", "put", name, "--config", "wrangler.jsonc"],
      { cwd: root, stdio: ["pipe", "inherit", "inherit"], windowsHide: true },
    );
    child.stdin.end(value);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${name} konnte nicht gesetzt werden.`));
    });
  });
}

const pin = await readHidden("Erste Administrator-PIN (6 bis 12 Ziffern): ");
const pinConfirmation = await readHidden("Administrator-PIN wiederholen: ");
if (!/^\d{6,12}$/.test(pin) || pin !== pinConfirmation) {
  throw new Error("PIN muss aus 6 bis 12 Ziffern bestehen und übereinstimmen.");
}
const setupCode = await readHidden("Einmaliger Einrichtungscode (mindestens 8 Zeichen): ");
const setupConfirmation = await readHidden("Einrichtungscode wiederholen: ");
if (setupCode.length < 8 || setupCode !== setupConfirmation) {
  throw new Error("Einrichtungscode ist zu kurz oder stimmt nicht überein.");
}

await putSecret("ADMIN_PIN_HASH", createHash("sha256").update(pin).digest("hex"));
await putSecret("BOOTSTRAP_TOKEN", setupCode);
process.stdout.write("Cloudflare-Secrets wurden gesetzt. Öffne nun /setup.\n");
