import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MIGRATION_FILE_PATTERN = /^\d{4}_.+\.sql$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function loadMigrationSafety(repositoryRoot, migrationFiles) {
  const migrationsDirectory = resolve(repositoryRoot, "apps", "worker", "migrations");
  const metadataPath = resolve(migrationsDirectory, "deployment-safety.json");
  const document = JSON.parse(await readFile(metadataPath, "utf8"));
  if (document?.schemaVersion !== 1 || !Array.isArray(document.migrations)) {
    throw new Error("Migration deployment safety metadata must use schema version 1.");
  }

  const expectedFiles = new Set(migrationFiles);
  const seenFiles = new Set();
  const entries = [];
  for (const rawEntry of document.migrations) {
    if (
      !rawEntry ||
      typeof rawEntry !== "object" ||
      typeof rawEntry.file !== "string" ||
      !MIGRATION_FILE_PATTERN.test(rawEntry.file) ||
      typeof rawEntry.sha256 !== "string" ||
      !SHA256_PATTERN.test(rawEntry.sha256) ||
      typeof rawEntry.onlineSafe !== "boolean" ||
      typeof rawEntry.initialOnly !== "boolean" ||
      typeof rawEntry.recoveryReference !== "string" ||
      rawEntry.recoveryReference.length === 0
    ) {
      throw new Error("Migration deployment safety metadata contains an invalid entry.");
    }
    if (!expectedFiles.has(rawEntry.file)) {
      throw new Error(`Migration safety metadata references unknown file ${rawEntry.file}.`);
    }
    if (seenFiles.has(rawEntry.file)) {
      throw new Error(`Migration safety metadata contains duplicate file ${rawEntry.file}.`);
    }
    if (rawEntry.onlineSafe === rawEntry.initialOnly) {
      throw new Error(
        `${rawEntry.file} must be either online-safe or initial-only, but never both or neither.`,
      );
    }

    const source = await readFile(resolve(migrationsDirectory, rawEntry.file));
    const actualHash = createHash("sha256").update(source).digest("hex");
    if (actualHash !== rawEntry.sha256) {
      throw new Error(
        `${rawEntry.file} changed after its deployment safety review; update the migration instead of its recorded checksum.`,
      );
    }
    seenFiles.add(rawEntry.file);
    entries.push(Object.freeze({ ...rawEntry }));
  }

  const missingFiles = migrationFiles.filter((file) => !seenFiles.has(file));
  if (missingFiles.length > 0) {
    throw new Error(`Migration deployment safety metadata is missing: ${missingFiles.join(", ")}.`);
  }
  return entries;
}

export function pendingOnlineMigrations(entries, appliedMigrationNames) {
  const applied = new Set(appliedMigrationNames);
  const pending = entries.filter((entry) => !applied.has(entry.file));
  const unsafe = pending.filter((entry) => !entry.onlineSafe || entry.initialOnly);
  if (unsafe.length > 0) {
    throw new Error(
      `Automatic deployment refuses non-online migration(s): ${unsafe.map((entry) => entry.file).join(", ")}.`,
    );
  }
  return pending;
}
