// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createMigratedTestDatabase,
  describeDatabaseSchema,
} from "../test-support/migrated-database";
import { analysisRetentionDays } from "./analysis-archive";
import { analysisExportPageSize, analysisExportProjections } from "./analysis-export-projections";
import type { Env } from "./types";

const writerSource = readFileSync(new URL("./analysis-archive-writer.ts", import.meta.url), "utf8");
const deletionSource = readFileSync(new URL("./event-deletion.ts", import.meta.url), "utf8");

describe("analysis archive boundaries", () => {
  it("prepares every projection against the complete migrated schema", () => {
    const database = createMigratedTestDatabase();
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

  it("keeps automatic archive jobs unique and their access events append-only", () => {
    const database = createMigratedTestDatabase();
    const schema = describeDatabaseSchema(database);
    const archiveTable = schema.tables.find(({ name }) => name === "analysis_archives");
    const triggerNames = schema.triggers.map(({ name }) => name);

    expect(archiveTable?.indexes.some((index) => (index as { unique?: number }).unique === 1)).toBe(
      true,
    );
    expect(triggerNames).toContain("analysis_archive_events_no_update");
    expect(triggerNames).toContain("analysis_archive_events_no_delete");
    database.close();
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
