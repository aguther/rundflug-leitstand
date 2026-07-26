import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const action = process.argv[2];
if (!["build", "check"].includes(action)) {
  throw new Error("Aufruf: node scripts/run_role_guides.mjs build|check");
}
const candidates = [
  process.env.ROLE_GUIDE_PYTHON,
  process.platform === "win32"
    ? resolve(
        homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe",
      )
    : null,
  process.platform === "win32" ? "python" : "python3",
].filter(Boolean);
const script =
  action === "build" ? "scripts/build_role_guides.py" : "scripts/verify_role_guides.py";
let lastError = null;
for (const python of candidates) {
  if (python.includes("/") || python.includes("\\")) {
    if (!existsSync(python)) continue;
  }
  const result = spawnSync(python, [script], {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status === 0) process.exit(0);
  lastError = result.error ?? new Error(`${python} lieferte Status ${result.status}.`);
}
throw new Error(
  `Rollen-PDF-${action} fehlgeschlagen. Installiere reportlab, pypdf und pdfplumber oder setze ROLE_GUIDE_PYTHON. ${lastError?.message ?? ""}`,
);
