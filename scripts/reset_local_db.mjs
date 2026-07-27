import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";

const removeLocalState = async () => {
  const retryableWindowsErrors = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      await rm(".wrangler/state", { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? String(error.code) : null;
      if (!code || !retryableWindowsErrors.has(code) || attempt === 24) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
};

await removeLocalState();
const scripts = process.argv.includes("--empty")
  ? ["db:migrate:local"]
  : ["db:migrate:local", "db:seed:local"];
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
for (const script of scripts) {
  const result = spawnSync(process.execPath, [npmCli, "run", script], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
