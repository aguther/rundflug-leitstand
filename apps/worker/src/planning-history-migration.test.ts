import { describe, expect, it } from "vitest";
import { createMigratedTestDatabase } from "../test-support/migrated-database";

function insertEvent(database: ReturnType<typeof createMigratedTestDatabase>, id: string) {
  database
    .prepare(
      `INSERT INTO operation_days
        (id, name, event_date, status, version, created_at, updated_at)
       VALUES (?1, ?2, '2026-08-16', 'ACTIVE', 1, ?3, ?3)`,
    )
    .run(id, `Synthetic ${id}`, "2026-08-16T00:00:00.000Z");
}

function insertContextAndRun(
  database: ReturnType<typeof createMigratedTestDatabase>,
  input: { eventId: string; contextId: string; runId: string; capturedAt: string },
) {
  database
    .prepare(
      `INSERT INTO planning_contexts
        (id, operation_day_id, operation_day_version, schema_version, previous_context_id,
         manifest_json, manifest_hash, anchor_reason, created_at)
       VALUES (?1, ?2, 1, 1, NULL, '[]', ?3, 'TEST', ?4)`,
    )
    .run(input.contextId, input.eventId, "a".repeat(64), input.capturedAt);
  database
    .prepare(
      `INSERT INTO planning_runs
        (id, operation_day_id, operation_day_version, context_id, previous_run_id, anchor_run_id,
         replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
         anchor_reason, application_version, requirements_version, source_revision,
         dispatch_plan_revision, forecast_digest, forecast_semantic_digest, precall_digest,
         duration_ms, status, failure_code)
       VALUES (?1, ?2, 1, ?3, NULL, ?1, 0, ?4, ?4, 'TEST', 'ANCHOR', 'TEST',
               '1.12.0', '1.12.0', 'test', 'revision', ?5, ?5, ?5, 1, 'SUCCEEDED', NULL)`,
    )
    .run(input.runId, input.eventId, input.contextId, input.capturedAt, "b".repeat(64));
}

function insertCompaction(
  database: ReturnType<typeof createMigratedTestDatabase>,
  input: { id: string; eventId: string; runId: string; contextId: string },
) {
  database
    .prepare(
      `INSERT INTO planning_history_compactions
        (id, operation_day_id, format_version, privacy_profile, status,
         segment_start_run_id, segment_start_captured_at, segment_end_run_id,
         segment_end_captured_at, continuation_run_id, continuation_context_id,
         terminal_segment, object_key, checksum_key, source_revision, application_version,
         requirements_version, requested_at, expires_at)
       VALUES (?1, ?2, 1, 'SUPPORT_SAFE', 'VERIFIED', ?3, ?4, ?3, ?4, ?3, ?5, 0,
               ?6, ?7, 'test', '1.12.0', '1.12.0', ?4, '2031-08-16T00:00:00.000Z')`,
    )
    .run(
      input.id,
      input.eventId,
      input.runId,
      "2026-08-16T00:00:00.000Z",
      input.contextId,
      `planning-history/${input.eventId}/${input.id}.zip`,
      `planning-history/${input.eventId}/${input.id}.zip.sha256`,
    );
}

describe("planning history compaction migration", () => {
  it("accepts analysis archive formats one and two while rejecting unknown formats", () => {
    const database = createMigratedTestDatabase();
    insertEvent(database, "event-one");
    const insert = database.prepare(
      `INSERT INTO analysis_archives
        (id, operation_day_id, operation_day_version, request_id, request_hash,
         privacy_profile, format_version, status, source_revision, application_version,
         requirements_version, entry_counts_json, requested_at, expires_at)
       VALUES (?1, 'event-one', 1, ?2, ?3, 'SUPPORT_SAFE', ?4, 'PENDING', 'test',
               '1.12.0', '1.12.0', '{}', ?5, ?6)`,
    );
    expect(() =>
      insert.run(
        "archive-v1",
        "request-v1",
        "a".repeat(64),
        1,
        "2026-08-16T00:00:00.000Z",
        "2026-09-16T00:00:00.000Z",
      ),
    ).not.toThrow();
    expect(() =>
      insert.run(
        "archive-v2",
        "request-v2",
        "b".repeat(64),
        2,
        "2026-08-16T00:00:00.000Z",
        "2026-09-16T00:00:00.000Z",
      ),
    ).not.toThrow();
    expect(() =>
      insert.run(
        "archive-v3",
        "request-v3",
        "c".repeat(64),
        3,
        "2026-08-16T00:00:00.000Z",
        "2026-09-16T00:00:00.000Z",
      ),
    ).toThrow();
    database.close();
  });

  it("permits only maintenance-scoped boundary changes and history deletion", () => {
    const database = createMigratedTestDatabase();
    insertEvent(database, "event-one");
    insertEvent(database, "event-two");
    insertContextAndRun(database, {
      eventId: "event-one",
      contextId: "context-one",
      runId: "run-one",
      capturedAt: "2026-08-16T00:00:00.000Z",
    });
    insertContextAndRun(database, {
      eventId: "event-two",
      contextId: "context-two",
      runId: "run-two",
      capturedAt: "2026-08-16T00:00:00.000Z",
    });
    insertCompaction(database, {
      id: "compaction-one",
      eventId: "event-one",
      runId: "run-one",
      contextId: "context-one",
    });

    expect(() => database.prepare("DELETE FROM planning_runs WHERE id = 'run-one'").run()).toThrow(
      /append-only/,
    );
    database
      .prepare(
        `UPDATE planning_history_maintenance_control
            SET active = 1, compaction_id = 'compaction-one', operation_day_id = 'event-one',
                boundary_run_id = 'run-one', boundary_context_id = 'context-one',
                activated_at = '2026-08-16T01:00:00.000Z'
          WHERE singleton = 1`,
      )
      .run();
    expect(() =>
      database
        .prepare(
          "UPDATE planning_runs SET previous_run_id = NULL, anchor_run_id = NULL WHERE id = 'run-one'",
        )
        .run(),
    ).not.toThrow();
    expect(() => database.prepare("DELETE FROM planning_runs WHERE id = 'run-two'").run()).toThrow(
      /append-only/,
    );
    expect(() =>
      database.prepare("DELETE FROM planning_runs WHERE id = 'run-one'").run(),
    ).not.toThrow();
    database.close();
  });

  it("keeps the compaction lifecycle log append-only", () => {
    const database = createMigratedTestDatabase();
    insertEvent(database, "event-one");
    insertContextAndRun(database, {
      eventId: "event-one",
      contextId: "context-one",
      runId: "run-one",
      capturedAt: "2026-08-16T00:00:00.000Z",
    });
    insertCompaction(database, {
      id: "compaction-one",
      eventId: "event-one",
      runId: "run-one",
      contextId: "context-one",
    });
    database
      .prepare(
        `INSERT INTO planning_history_compaction_events
          (id, compaction_id, operation_day_id, event_type, occurred_at, details_json)
         VALUES ('event-log-one', 'compaction-one', 'event-one', 'PACKAGE_VERIFIED',
                 '2026-08-16T01:00:00.000Z', '{}')`,
      )
      .run();
    expect(() =>
      database
        .prepare(
          "UPDATE planning_history_compaction_events SET details_json = '{\"changed\":true}'",
        )
        .run(),
    ).toThrow(/append-only/);
    expect(() => database.prepare("DELETE FROM planning_history_compaction_events").run()).toThrow(
      /append-only/,
    );
    database.close();
  });
});
