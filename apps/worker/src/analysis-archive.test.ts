// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { analysisRetentionDays } from "./analysis-archive";
import { analysisExportPageSize, analysisExportProjections } from "./analysis-export-projections";
import type { Env } from "./types";

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const coordinatorSource = readFileSync(new URL("./event-coordinator.ts", import.meta.url), "utf8");
const writerSource = readFileSync(new URL("./analysis-archive-writer.ts", import.meta.url), "utf8");
const deletionSource = readFileSync(new URL("./event-deletion.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../migrations/0063_analysis_day_archives.sql", import.meta.url),
  "utf8",
);

describe("analysis archive boundaries", () => {
  it("prepares every projection against the complete migrated schema", () => {
    const database = new DatabaseSync(":memory:");
    const migrationsDirectory = new URL("../migrations/", import.meta.url);
    for (const migrationName of readdirSync(migrationsDirectory)
      .filter((name: string) => /^\d+.*\.sql$/.test(name))
      .toSorted()) {
      database.exec(readFileSync(new URL(migrationName, migrationsDirectory), "utf8"));
    }
    database
      .prepare(
        `INSERT INTO operation_days (id, name, event_date, created_at, updated_at)
         VALUES ('analysis-test', 'Synthetic', '2026-08-02', '2026-08-02T08:00:00.000Z',
                 '2026-08-02T08:00:00.000Z')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES ('event-canary', 'analysis-test', 'SYNTHETIC_CANARY',
                 '2026-08-02T08:01:00.000Z', 'secret-device-canary', 'OPERATION_DAY',
                 'analysis-test', 1, '{"token":"secret-payload-canary"}')`,
      )
      .run();
    for (const projection of analysisExportProjections) {
      const rows = database
        .prepare(`${projection.pageSql} LIMIT ?2 OFFSET ?3`)
        .all("analysis-test", 250, 0);
      expect(JSON.stringify(rows)).not.toContain("secret-payload-canary");
      expect(JSON.stringify(rows)).not.toContain("secret-device-canary");
      expect(() => database.prepare(projection.countSql).get("analysis-test")).not.toThrow();
    }
  });

  it("uses explicit paged support-safe projections", () => {
    const sql = analysisExportProjections.map((projection) => projection.pageSql).join("\n");
    expect(analysisExportPageSize).toBe(250);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).not.toContain("public_code_hash");
    expect(sql).not.toContain("public_status_code_hash");
    expect(sql).not.toContain("individual_weight_kg");
    expect(sql).not.toContain("payment_method");
    expect(sql).not.toContain("payload_json\n                FROM operational_events");
    expect(sql).not.toContain("operational_note");
    expect(sql).not.toContain("reason TEXT");
  });

  it("keeps the zip and R2 path streaming", () => {
    expect(writerSource).toContain("createMultipartUpload");
    expect(writerSource).toContain("TransformStream");
    expect(writerSource).not.toContain("zipSync");
    expect(writerSource).not.toContain("new Blob");
  });

  it("creates the archive job with the close command but builds outside its batch", () => {
    expect(coordinatorSource).toContain("automaticArchiveRequestStatements");
    expect(coordinatorSource).toContain(
      "this.ctx.waitUntil(forecastWork.then(() => processPendingAnalysisArchives",
    );
    expect(migration).toContain("UNIQUE(operation_day_id, operation_day_version");
    expect(migration).toContain("analysis_archive_events is append-only");
  });

  it("protects every archive endpoint with the admin role", () => {
    expect(indexSource).toContain('eventRoutes("/analysis/day-archives")');
    expect(indexSource).toContain('eventRoutes("/analysis/day-archives/:archiveId/download")');
    expect(indexSource).toContain('eventRoutes("/analysis/day-archives/:archiveId")');
    expect(indexSource.match(/actor\.role !== "ADMIN"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("removes all event-scoped archive objects on event deletion", () => {
    expect(deletionSource).toContain("`analysis/" + "$" + "{response.eventId}" + "/`");
    expect(deletionSource).toContain("DELETE FROM analysis_archive_events");
    expect(deletionSource).toContain("DELETE FROM analysis_archives");
  });

  it("requires explicit bounded production retention", () => {
    expect(analysisRetentionDays({ APP_ENV: "development" } as Env)).toBe(30);
    expect(() => analysisRetentionDays({ APP_ENV: "production" } as Env)).toThrow(
      "ANALYSIS_RETENTION_DAYS_REQUIRED",
    );
    expect(() =>
      analysisRetentionDays({ APP_ENV: "acceptance", ANALYSIS_RETENTION_DAYS: "366" } as Env),
    ).toThrow("ANALYSIS_RETENTION_DAYS_INVALID");
  });
});
