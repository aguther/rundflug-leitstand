import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { restorePlanningHistoryPackages } from "./lib/planning-history-restore.mjs";

const args = process.argv.slice(2);
const databaseIndex = args.indexOf("--isolated-database");
const packagePaths = args
  .map((value, index) => (value === "--package" ? args[index + 1] : null))
  .filter(Boolean);
if (databaseIndex < 0 || !args[databaseIndex + 1] || packagePaths.length === 0) {
  throw new Error(
    "Usage: node scripts/restore_planning_history.mjs --isolated-database <sqlite> --package <zip> [--package <zip>]",
  );
}
const databasePath = resolve(args[databaseIndex + 1]);
if (/[/\\]\.wrangler[/\\]|production/i.test(databasePath)) {
  throw new Error("PLANNING_HISTORY_RESTORE_REQUIRES_ISOLATED_DATABASE");
}
const database = new DatabaseSync(databasePath);
try {
  database.exec("PRAGMA foreign_keys = ON");
  const result = restorePlanningHistoryPackages(
    database,
    packagePaths.map((path) => new Uint8Array(readFileSync(resolve(path)))),
  );
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} finally {
  database.close();
}
