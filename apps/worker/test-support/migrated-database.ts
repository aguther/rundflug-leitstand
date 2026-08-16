// @ts-expect-error Tests execute in Node while the Worker production config excludes Node types.
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error Tests execute in Node while the Worker production config excludes Node types.
import { DatabaseSync } from "node:sqlite";

const migrationsUrl = new URL("../migrations/", import.meta.url);
const baselineUrl = new URL("0001_v1_12_baseline.sql", migrationsUrl);
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

function createEmptyTestDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

export function createBaselineTestDatabase(): DatabaseSync {
  const database = createEmptyTestDatabase();
  database.exec(readBaselineSql());
  return database;
}

export function readMigrationSql(): string[] {
  return readdirSync(migrationsUrl)
    .filter((name: string) => /^\d{4}_.+\.sql$/.test(name))
    .sort((left: string, right: string) => left.localeCompare(right, "en"))
    .map((name: string) => readFileSync(new URL(name, migrationsUrl), "utf8"));
}

export function createMigratedTestDatabase(): DatabaseSync {
  const database = createEmptyTestDatabase();
  for (const migrationSql of readMigrationSql()) database.exec(migrationSql);
  return database;
}

function createD1PreparedStatement(
  database: DatabaseSync,
  sql: string,
  bindings: readonly unknown[] = [],
): D1PreparedStatement {
  const statement = database.prepare(sql);
  const rows = () => plainRows(statement.all(...bindings) as SqliteRow[]);

  const executeForBatch = async () => {
    if (/^\s*(?:SELECT|PRAGMA)\b/i.test(sql)) {
      return { success: true, results: rows(), meta: {} } as D1Result;
    }
    const result = statement.run(...bindings);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    } as unknown as D1Result;
  };
  return {
    bind: (...values: unknown[]) => createD1PreparedStatement(database, sql, values),
    first: async <T = SqliteRow>(column?: string) => {
      const row = statement.get(...bindings) as SqliteRow | undefined;
      if (!row) return null;
      return (column ? row[column] : { ...row }) as T;
    },
    all: async <T = SqliteRow>() => {
      const results = rows() as T[];
      return { success: true, results, meta: {} } as D1Result<T>;
    },
    raw: async <T = unknown[]>(options?: { columnNames?: boolean }) => {
      const resultRows = rows();
      const columnNames = resultRows.length > 0 ? Object.keys(resultRows[0] ?? {}) : [];
      const values = resultRows.map((row) => columnNames.map((name) => row[name])) as T[];
      return (options?.columnNames ? [columnNames, ...values] : values) as T[];
    },
    run: async () => {
      const result = statement.run(...bindings);
      return {
        success: true,
        results: [],
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
      } as unknown as D1Result;
    },
    executeForBatch,
  } as unknown as D1PreparedStatement;
}

export function createD1TestDatabase(): {
  database: DatabaseSync;
  d1: D1Database;
  close: () => void;
} {
  const database = createMigratedTestDatabase();
  const prepare = (sql: string) => createD1PreparedStatement(database, sql);

  const d1 = {
    prepare,
    batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
      database.exec("BEGIN");
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) {
          results.push(
            await (
              statement as D1PreparedStatement & {
                executeForBatch(): Promise<D1Result<T>>;
              }
            ).executeForBatch(),
          );
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    exec: async (sql: string) => {
      database.exec(sql);
      return { count: 1, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;

  return { database, d1, close: () => database.close() };
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
