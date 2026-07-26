import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const recoveryCode = randomBytes(24).toString("base64url");
const signingKey = randomBytes(32).toString("base64url");

await new Promise((resolvePromise, reject) => {
  const child = spawn(
    process.execPath,
    [wrangler, "secret", "bulk", "--config", "wrangler.jsonc"],
    {
      cwd: root,
      stdio: ["pipe", "inherit", "inherit"],
      windowsHide: true,
    },
  );
  child.stdin.end(
    JSON.stringify({
      INSTALLATION_RECOVERY_CODE: recoveryCode,
      RESET_SETUP_SIGNING_KEY: signingKey,
    }),
  );
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) resolvePromise();
    else reject(new Error("Installations-Secrets konnten nicht gesetzt werden."));
  });
});

process.stdout.write(
  "\nINSTALLATIONS-NOTFALLCODE – JETZT EINMALIG IM PASSWORTSAFE SICHERN\n" +
    `${recoveryCode}\n` +
    "Der Code und der Signierschlüssel wurden nicht in eine Datei geschrieben.\n",
);
