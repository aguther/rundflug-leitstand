import { describe, expect, it, vi } from "vitest";
import { applyDemoSeed, createD1TestDatabase } from "../test-support/migrated-database";
import {
  analysisActorAlias,
  analysisArchiveDownload,
  automaticArchiveRequestStatements,
  deleteAnalysisArchive,
  expireAnalysisArchives,
  listAnalysisArchives,
  processPendingAnalysisArchives,
  requestAnalysisArchive,
} from "./analysis-archive";
import { sha256Hex } from "./crypto";
import type { Env } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
  run?: () => Promise<unknown>;
}

function archiveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "archive-one",
    operation_day_id: "event-one",
    operation_day_version: 7,
    request_id: "request-one",
    request_hash: "hash-one",
    privacy_profile: "SUPPORT_SAFE",
    format_version: 1,
    status: "READY",
    object_key: "analysis/event-one/archive-one.zip",
    object_etag: "etag-one",
    object_size_bytes: 123,
    content_type: "application/zip",
    source_revision: "revision-one",
    application_version: "1.12.0",
    requirements_version: "1.12.0",
    entry_counts_json: "{}",
    requested_at: "2026-08-08T08:00:00.000Z",
    started_at: "2026-08-08T08:01:00.000Z",
    completed_at: "2026-08-08T08:02:00.000Z",
    expires_at: "2026-09-08T08:00:00.000Z",
    failure_code: null,
    version: 3,
    ...overrides,
  };
}

function createEnvironment(
  input: {
    first?: Array<Record<string, unknown> | null>;
    all?: Record<string, unknown>[][];
    runChanges?: number[];
    object?: R2ObjectBody | null;
  } = {},
) {
  const firstResults = [...(input.first ?? [])];
  const allResults = [...(input.all ?? [])];
  const runChanges = [...(input.runChanges ?? [])];
  const batches: PreparedQuery[][] = [];
  const runs: PreparedQuery[] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const query: PreparedQuery = { sql, parameters };
      return {
        ...query,
        first: async () => firstResults.shift() ?? null,
        all: async () => ({ results: allResults.shift() ?? [] }),
        run: async () => {
          runs.push(query);
          return { success: true, results: [], meta: { changes: runChanges.shift() ?? 1 } };
        },
      };
    },
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) => {
    batches.push(statements);
    return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
  });
  const backups = {
    get: vi.fn(async () => input.object ?? null),
    delete: vi.fn(async () => undefined),
  };
  const env = {
    APP_ENV: "development",
    DATA_JURISDICTION: "eu",
    DB: { prepare, batch } as unknown as D1Database,
    BACKUPS: backups as unknown as R2Bucket,
  } as Env;
  return { env, batches, runs, backups };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-one",
    event_date: "2026-08-08",
    time_zone: "Europe/Berlin",
    status: "CLOSED",
    version: 7,
    ...overrides,
  };
}

describe("analysis archive service", () => {
  it("persists an archive request and its ledger event atomically in migrated SQLite", async () => {
    const testDatabase = createD1TestDatabase();
    try {
      applyDemoSeed(testDatabase.database);
      testDatabase.database
        .prepare("UPDATE operation_days SET status = 'CLOSED', version = 7 WHERE id = ?1")
        .run("demo-2026");
      const env = {
        APP_ENV: "development",
        DATA_JURISDICTION: "eu",
        DB: testDatabase.d1,
        BACKUPS: {} as R2Bucket,
      } as Env;

      const result = await requestAnalysisArchive({
        env,
        eventId: "demo-2026",
        expectedEventVersion: 7,
        requestId: "550e8400-e29b-41d4-a716-446655440071",
        actorAlias: "synthetic-actor",
        now: new Date("2026-08-08T09:00:00.000Z"),
      });

      expect(result).toMatchObject({ created: true, archive: { status: "PENDING" } });
      expect(
        testDatabase.database
          .prepare(
            `SELECT a.status, a.operation_day_version, e.event_type, e.actor_alias
               FROM analysis_archives a
               JOIN analysis_archive_events e ON e.archive_id = a.id
              WHERE a.request_id = ?1`,
          )
          .get("550e8400-e29b-41d4-a716-446655440071"),
      ).toEqual({
        status: "PENDING",
        operation_day_version: 7,
        event_type: "ARCHIVE_REQUESTED",
        actor_alias: "synthetic-actor",
      });

      await expect(
        requestAnalysisArchive({
          env,
          eventId: "demo-2026",
          expectedEventVersion: 7,
          requestId: "550e8400-e29b-41d4-a716-446655440071",
          actorAlias: "synthetic-actor",
        }),
      ).resolves.toMatchObject({ created: false, archive: { id: result.archive.id } });
      expect(
        testDatabase.database.prepare("SELECT COUNT(*) AS count FROM analysis_archives").get(),
      ).toEqual({ count: 1 });
    } finally {
      testDatabase.close();
    }
  });

  it("derives privacy-safe stable actor aliases", async () => {
    await expect(analysisActorAlias(null)).resolves.toBe("development-admin");
    const alias = await analysisActorAlias("synthetic-admin-account");
    expect(alias).toMatch(/^analysis-actor-[a-f0-9]{16}$/);
    expect(alias).not.toContain("synthetic-admin-account");
  });

  it("builds deterministic automatic request statements", async () => {
    const { env } = createEnvironment();

    const statements = await automaticArchiveRequestStatements({
      env,
      eventId: "event-one",
      eventVersion: 7,
      requestedAt: "2026-08-08T08:00:00.000Z",
    });

    expect(statements).toHaveLength(2);
    expect((statements[0] as unknown as PreparedQuery).parameters[0]).toMatch(/^archive-/);
    expect((statements[1] as unknown as PreparedQuery).sql).toContain("ARCHIVE_REQUESTED");
  });

  it("returns an idempotent prior request and rejects a conflicting request id", async () => {
    const expectedHash = await sha256Hex(
      JSON.stringify({
        eventId: "event-one",
        eventVersion: 7,
        formatVersion: 2,
        privacyProfile: "SUPPORT_SAFE",
      }),
    );
    const matching = createEnvironment({ first: [archiveRow({ request_hash: expectedHash })] });
    await expect(
      requestAnalysisArchive({
        env: matching.env,
        eventId: "event-one",
        expectedEventVersion: 7,
        requestId: "request-one",
        actorAlias: "actor-one",
      }),
    ).resolves.toMatchObject({ created: false, archive: { id: "archive-one" } });

    const conflicting = createEnvironment({ first: [archiveRow({ request_hash: "different" })] });
    await expect(
      requestAnalysisArchive({
        env: conflicting.env,
        eventId: "event-one",
        expectedEventVersion: 7,
        requestId: "request-one",
        actorAlias: "actor-one",
      }),
    ).rejects.toThrow("ANALYSIS_ARCHIVE_IDEMPOTENCY_CONFLICT");
  });

  it.each([
    [null, "EVENT_NOT_FOUND"],
    [eventRow({ version: 8 }), "ANALYSIS_ARCHIVE_STALE_VERSION"],
    [eventRow({ status: "ACTIVE" }), "ANALYSIS_ARCHIVE_EVENT_OPEN"],
  ] as const)("validates the source event before archive creation", async (event, code) => {
    const { env } = createEnvironment({ first: [null, event] });
    await expect(
      requestAnalysisArchive({
        env,
        eventId: "event-one",
        expectedEventVersion: 7,
        requestId: "request-one",
        actorAlias: "actor-one",
      }),
    ).rejects.toThrow(code);
  });

  it("requeues a failed archive and records the retry", async () => {
    const failed = archiveRow({ status: "FAILED", failure_code: "ARCHIVE_BUILD_FAILED" });
    const retried = archiveRow({ status: "PENDING", failure_code: null, version: 4 });
    const { env, batches } = createEnvironment({ first: [null, eventRow(), failed, retried] });

    const result = await requestAnalysisArchive({
      env,
      eventId: "event-one",
      expectedEventVersion: 7,
      requestId: "request-one",
      actorAlias: "actor-one",
      now: new Date("2026-08-08T09:00:00.000Z"),
    });

    expect(result).toMatchObject({ created: true, archive: { status: "PENDING" } });
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]?.[0]?.sql).toContain("SET status = 'PENDING'");
  });

  it("creates a new archive and returns its persisted projection", async () => {
    const created = archiveRow({ status: "PENDING", object_key: null, completed_at: null });
    const { env, batches } = createEnvironment({ first: [null, eventRow(), null, created] });

    const result = await requestAnalysisArchive({
      env,
      eventId: "event-one",
      expectedEventVersion: 7,
      requestId: "request-one",
      actorAlias: "actor-one",
      now: new Date("2026-08-08T09:00:00.000Z"),
    });

    expect(result).toMatchObject({ created: true, archive: { status: "PENDING" } });
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]?.[0]?.sql).toContain("INSERT INTO analysis_archives");
  });

  it("lists archive projections in storage order", async () => {
    const { env } = createEnvironment({
      all: [[archiveRow(), archiveRow({ id: "archive-two", status: "FAILED" })]],
    });
    await expect(listAnalysisArchives(env, "event-one")).resolves.toMatchObject([
      { id: "archive-one", status: "READY" },
      { id: "archive-two", status: "FAILED" },
    ]);
  });

  it("downloads only a ready archive and appends an access event", async () => {
    const object = { body: new ReadableStream() } as unknown as R2ObjectBody;
    const { env, runs, backups } = createEnvironment({ first: [archiveRow()], object });

    const result = await analysisArchiveDownload({
      env,
      eventId: "event-one",
      archiveId: "archive-one",
      actorAlias: "actor-one",
    });

    expect(result).toMatchObject({ archive: { id: "archive-one" }, object });
    expect(backups.get).toHaveBeenCalledWith("analysis/event-one/archive-one.zip");
    expect(runs[0]?.sql).toContain("INSERT INTO analysis_archive_events");
  });

  it("deletes an archive object and returns the updated tombstone", async () => {
    const deleted = archiveRow({ status: "DELETED", object_key: null, object_size_bytes: null });
    const { env, backups, batches } = createEnvironment({ first: [archiveRow(), deleted] });

    const result = await deleteAnalysisArchive({
      env,
      eventId: "event-one",
      archiveId: "archive-one",
      actorAlias: "actor-one",
    });

    expect(result).toMatchObject({ id: "archive-one", status: "DELETED" });
    expect(backups.delete).toHaveBeenCalledWith("analysis/event-one/archive-one.zip");
    expect(batches[0]).toHaveLength(2);
  });

  it("expires ready archive objects in bounded batches", async () => {
    const { env, backups, batches } = createEnvironment({
      all: [[archiveRow(), archiveRow({ id: "archive-two", object_key: null })]],
    });

    const count = await expireAnalysisArchives(env, new Date("2026-10-01T00:00:00.000Z"), 25);

    expect(count).toBe(2);
    expect(backups.delete).toHaveBeenCalledOnce();
    expect(batches).toHaveLength(2);
  });

  it("marks stale builds as failed without claiming new pending work", async () => {
    const { env, runs } = createEnvironment({
      all: [[{ id: "archive-stale", operation_day_id: "event-one" }], []],
      runChanges: [1, 1],
    });

    await expect(processPendingAnalysisArchives(env, 2)).resolves.toBe(0);
    expect(runs.some(({ sql }) => sql.includes("ARCHIVE_BUILD_TIMEOUT"))).toBe(true);
    expect(runs.some(({ sql }) => sql.includes("INSERT INTO analysis_archive_events"))).toBe(true);
  });
});
