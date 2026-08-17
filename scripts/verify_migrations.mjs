import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadMigrationSafety } from "./lib/migration-safety.mjs";
import { compareTechnicalStrings } from "./lib/technical-order.mjs";

const root = resolve(import.meta.dirname, "..");
const migrationsDirectory = resolve(root, "apps", "worker", "migrations");
const readmePath = resolve(migrationsDirectory, "README.md");
const registerPath = resolve(root, "docs", "operations", "migrations-current.md");

const files = (await readdir(migrationsDirectory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort(compareTechnicalStrings);
const byNumber = new Map();
for (const file of files) {
  const number = file.slice(0, 4);
  const entries = byNumber.get(number) ?? [];
  entries.push(file);
  byNumber.set(number, entries);
}

const safetyEntries = await loadMigrationSafety(root, files);
const safetyByFile = new Map(safetyEntries.map((entry) => [entry.file, entry]));
for (const [number, entries] of byNumber) {
  if (entries.length > 1) {
    throw new Error(`Doppelte Migrationsnummer ${number}: ${entries.join(", ")}`);
  }
}
for (const [index, file] of files.entries()) {
  const expectedNumber = String(index + 1).padStart(4, "0");
  const actualNumber = file.slice(0, 4);
  if (actualNumber !== expectedNumber) {
    throw new Error(
      `Migrationsfolge ist nicht lückenlos: ${file} verwendet ${actualNumber}, erwartet ist ${expectedNumber}.`,
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
  "# Aktuelles Migrationsregister – Release 1.12.0",
  "",
  "Diese Datei wird aus `apps/worker/migrations/*.sql` erzeugt. Vollständige Dateinamen sind die",
  "D1-Identität der neu begonnenen V1.12-Historie; angewandte Dateien werden nicht nachträglich",
  "umbenannt. Die vorherigen 69 Entwicklungsmigrationen werden nicht unterstützt und bleiben über Git",
  "nachvollziehbar (ADR-0045).",
  "",
  "| Reihenfolge | Datei | Deployment | Prüfsumme |",
  "| ---: | --- | --- | --- |",
  ...files.map((file, index) => {
    const safety = safetyByFile.get(file);
    const deployment = safety.onlineSafe ? "automatisch, online-sicher" : "nur Erstinstallation";
    return `| ${index + 1} | \`${file}\` | ${deployment} | \`${safety.sha256.slice(0, 12)}…\` |`;
  }),
  "",
  `Gesamt: ${files.length} Migrationen. Wiederherstellungsnotizen werden gegen SQL und`,
  "`apps/worker/migrations/README.md` geprüft. Für automatische Deployments werden zusätzlich die",
  "vollständigen SHA-256-Prüfsummen und die explizite Online-Sicherheitsfreigabe aus",
  "`apps/worker/migrations/deployment-safety.json` validiert.",
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
