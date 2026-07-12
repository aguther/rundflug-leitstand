import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";

await rm(".wrangler/state", { recursive: true, force: true });
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
