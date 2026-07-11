import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";

await rm(".wrangler/state", { recursive: true, force: true });
for (const script of ["db:migrate:local", "db:seed:local"]) {
  const result = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
