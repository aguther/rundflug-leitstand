// @ts-expect-error Tests execute in Node while the Worker production config excludes Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Tests execute in Node while the Worker production config excludes Node types.
import { DatabaseSync } from "node:sqlite";

const baselineUrl = new URL("../migrations/0001_v1_12_baseline.sql", import.meta.url);
const demoSeedUrl = new URL("../seed/demo.sql", import.meta.url);

export type SqliteRow = Record<string, unknown>;

function plainRows(rows: SqliteRow[]): SqliteRow[] {
  return rows.map((row) => ({ ...row }));
}

function pragmaIdentifier(identifier: string): string {
  return JSON.stringify(identifier);
}

export function readBaselineSql(): string {
  return readFileSync(baselineUrl, "utf8");
}

export function createMigratedTestDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(readBaselineSql());
  return database;
}

export function applyDemoSeed(database: DatabaseSync): void {
  database.exec(readFileSync(demoSeedUrl, "utf8"));
}

export function describeDatabaseSchema(database: DatabaseSync) {
  const objects = (type: "table" | "index" | "trigger") =>
    plainRows(
      database
        .prepare(
          `SELECT name, sql
             FROM sqlite_schema
            WHERE type = ?1
              AND name NOT GLOB 'sqlite_*'
              AND sql IS NOT NULL
            ORDER BY name`,
        )
        .all(type) as SqliteRow[],
    );
  const tables = objects("table");
  const namedIndexes = objects("index");
  const triggers = objects("trigger");

  return {
    version: "1.12.0",
    sourceMigrationCount: 69,
    objectCounts: {
      tables: tables.length,
      namedIndexes: namedIndexes.length,
      triggers: triggers.length,
    },
    tables: tables.map(({ name }) => {
      const tableName = String(name);
      const indexes = plainRows(
        database.prepare(`PRAGMA index_list(${pragmaIdentifier(tableName)})`).all() as SqliteRow[],
      )
        .toSorted((left, right) => String(left.name).localeCompare(String(right.name), "en"))
        .map((index) => {
          const { seq: _creationOrder, ...semanticIndex } = index;
          return {
            ...semanticIndex,
            columns: plainRows(
              database
                .prepare(`PRAGMA index_xinfo(${pragmaIdentifier(String(index.name))})`)
                .all() as SqliteRow[],
            ).toSorted((left, right) => Number(left.seqno) - Number(right.seqno)),
          };
        });

      return {
        name: tableName,
        columns: plainRows(
          database
            .prepare(`PRAGMA table_xinfo(${pragmaIdentifier(tableName)})`)
            .all() as SqliteRow[],
        ),
        foreignKeys: plainRows(
          database
            .prepare(`PRAGMA foreign_key_list(${pragmaIdentifier(tableName)})`)
            .all() as SqliteRow[],
        ).toSorted(
          (left, right) =>
            Number(left.id) - Number(right.id) || Number(left.seq) - Number(right.seq),
        ),
        indexes,
      };
    }),
    namedIndexes,
    triggers,
  };
}
