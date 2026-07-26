import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationsDirectory = resolve(root, "apps", "worker", "migrations");
const readmePath = resolve(migrationsDirectory, "README.md");
const registerPath = resolve(root, "docs", "operations", "migrations-current.md");
const allowedDuplicate = new Set([
  "0036_product_promised_flight_time.sql",
  "0036_v1_5_stable_operations.sql",
]);

const files = (await readdir(migrationsDirectory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const byNumber = new Map();
for (const file of files) {
  const number = file.slice(0, 4);
  const entries = byNumber.get(number) ?? [];
  entries.push(file);
  byNumber.set(number, entries);
}
for (const [number, entries] of byNumber) {
  if (
    entries.length > 1 &&
    (number !== "0036" ||
      entries.length !== allowedDuplicate.size ||
      entries.some((entry) => !allowedDuplicate.has(entry)))
  ) {
    throw new Error(
      `Nicht registrierte doppelte Migrationsnummer ${number}: ${entries.join(", ")}`,
    );
  }
}

const readme = await readFile(readmePath, "utf8");
const documentedRecoveryNumbers = new Set();
for (const match of readme.matchAll(/^## (\d{4})(?: bis (\d{4}))?\b/gm)) {
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  for (let number = start; number <= end; number += 1) {
    documentedRecoveryNumbers.add(String(number).padStart(4, "0"));
  }
}
for (const file of files) {
  const source = await readFile(resolve(migrationsDirectory, file), "utf8");
  const number = file.slice(0, 4);
  const inlineRecovery = /Wiederherstellung|Rollback|recovery|restore/i.test(source);
  const registeredRecovery = documentedRecoveryNumbers.has(number);
  if (!inlineRecovery && !registeredRecovery) {
    throw new Error(`${file}: Wiederherstellungsnotiz fehlt in SQL und Migrations-README.`);
  }
}

const lines = [
  "# Aktuelles Migrationsregister – Release 1.10.0",
  "",
  "Diese Datei wird aus `apps/worker/migrations/*.sql` erzeugt. Vollständige Dateinamen sind die",
  "D1-Identität; angewandte Dateien werden nicht nachträglich umbenannt.",
  "",
  "| Reihenfolge | Datei | Hinweis |",
  "| ---: | --- | --- |",
  ...files.map((file, index) => {
    const note = allowedDuplicate.has(file)
      ? "historische Doppelnummer 0036, ausdrücklich erlaubt"
      : "eindeutig";
    return `| ${index + 1} | \`${file}\` | ${note} |`;
  }),
  "",
  `Gesamt: ${files.length} Migrationen. Wiederherstellungsnotizen werden gegen SQL und`,
  "`apps/worker/migrations/README.md` geprüft.",
  "",
];
const expected = lines.join("\n");
if (process.argv.includes("--write")) {
  await writeFile(registerPath, expected, "utf8");
  process.stdout.write(`OK: ${files.length} Migrationen registriert\n`);
} else {
  const actual = await readFile(registerPath, "utf8");
  if (actual !== expected) {
    throw new Error("Migrationsregister ist veraltet. Führe npm run docs:migrations:build aus.");
  }
  process.stdout.write(`OK: ${files.length} Migrationen, Nummern und Recovery-Notizen geprüft\n`);
}
