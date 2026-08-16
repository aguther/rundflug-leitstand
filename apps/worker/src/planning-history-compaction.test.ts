import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createD1TestDatabase } from "../test-support/migrated-database";
import {
  buildPlanningHistoryPackage,
  claimPlanningHistoryCompactions,
  planningDetailRetentionHours,
  planningHistoryPruneLimits,
  planningHistoryRetentionYears,
  prunePlanningHistoryBatch,
} from "./planning-history-compaction";
import { startPlanningHistoryWorkflows } from "./planning-history-workflow";
import type { Env } from "./types";

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class<Environment> {
    protected readonly env: Environment;

    constructor(_context: ExecutionContext, env: Environment) {
      this.env = env;
    }
  },
}));

class NodeDigestStream extends WritableStream<ArrayBuffer | ArrayBufferView> {
  readonly digest: Promise<ArrayBuffer>;

  constructor() {
    const chunks: Uint8Array[] = [];
    let resolveDigest: (value: ArrayBuffer) => void = () => undefined;
    const digest = new Promise<ArrayBuffer>((resolve) => {
      resolveDigest = resolve;
    });
    super({
      write(chunk) {
        const bytes =
          chunk instanceof ArrayBuffer
            ? new Uint8Array(chunk)
            : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        chunks.push(bytes.slice());
      },
      async close() {
        const bytes = concatenate(chunks);
        resolveDigest(await crypto.subtle.digest("SHA-256", stableArrayBuffer(bytes)));
      },
    });
    this.digest = digest;
  }
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function stableArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  output.set(bytes);
  return output.buffer;
}

function memoryBucket(options: { failChecksumOnce?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  const objectMetadata = new Map<string, Record<string, string>>();
  let multipartCompletions = 0;
  let shouldFailChecksum = options.failChecksumOnce ?? false;
  const uploadedAt = new Date("2026-08-16T12:00:00.000Z");
  const r2Object = (key: string, bytes: Uint8Array): R2Object =>
    ({
      key,
      etag: `etag-${key}`,
      httpEtag: `"etag-${key}"`,
      size: bytes.byteLength,
      uploaded: uploadedAt,
      customMetadata: objectMetadata.get(key),
      checksums: {},
      storageClass: "Standard",
    }) as R2Object;
  const bucket = {
    async createMultipartUpload(key: string, options: R2MultipartOptions) {
      const parts = new Map<number, Uint8Array>();
      return {
        key,
        uploadId: `upload-${key}`,
        async uploadPart(partNumber: number, value: Uint8Array) {
          parts.set(partNumber, value.slice());
          return { partNumber, etag: `part-${partNumber}` };
        },
        async complete(uploaded: R2UploadedPart[]) {
          multipartCompletions += 1;
          const bytes = concatenate(
            uploaded.map((part) => parts.get(part.partNumber) ?? new Uint8Array()),
          );
          objects.set(key, bytes);
          objectMetadata.set(key, options.customMetadata ?? {});
          return r2Object(key, bytes);
        },
        async abort() {
          parts.clear();
        },
      } as R2MultipartUpload;
    },
    async put(key: string, value: string, options: R2PutOptions) {
      if (key.endsWith(".sha256") && shouldFailChecksum) {
        shouldFailChecksum = false;
        throw new Error("SYNTHETIC_CHECKSUM_UPLOAD_FAILURE");
      }
      const bytes = new TextEncoder().encode(value);
      objects.set(key, bytes);
      objectMetadata.set(key, options.customMetadata ?? {});
      return r2Object(key, bytes);
    },
    async get(key: string) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        ...r2Object(key, bytes),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice());
            controller.close();
          },
        }),
        bodyUsed: false,
        arrayBuffer: async () => stableArrayBuffer(bytes),
        blob: async () => new Blob([stableArrayBuffer(bytes)]),
        json: async <T>() => JSON.parse(strFromU8(bytes)) as T,
        text: async () => strFromU8(bytes),
      } as R2ObjectBody;
    },
    async head(key: string) {
      const bytes = objects.get(key);
      return bytes ? r2Object(key, bytes) : null;
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  } as unknown as R2Bucket;
  return { bucket, objects, multipartCompletions: () => multipartCompletions };
}

function seedPlanningHistory(database: ReturnType<typeof createD1TestDatabase>["database"]) {
  database.exec(`
    INSERT INTO operation_days
      (id, name, event_date, status, version, created_at, updated_at)
    VALUES
      ('event-one', 'Synthetic event', '2026-08-15', 'ACTIVE', 4,
       '2026-08-14T09:00:00.000Z', '2026-08-16T11:00:00.000Z');
  `);
  const times = [
    "2026-08-14T10:00:00.000Z",
    "2026-08-15T10:00:00.000Z",
    "2026-08-15T11:00:00.000Z",
    "2026-08-16T10:00:00.000Z",
  ];
  for (const [index, capturedAt] of times.entries()) {
    database
      .prepare(
        `INSERT INTO planning_contexts
          (id, operation_day_id, operation_day_version, schema_version, previous_context_id,
           manifest_json, manifest_hash, anchor_reason, created_at)
         VALUES (?1, 'event-one', ?2, 1, ?3, '[]', ?4, 'TEST', ?5)`,
      )
      .run(
        `context-${index}`,
        index + 1,
        index === 0 ? null : `context-${index - 1}`,
        String(index).repeat(64),
        capturedAt,
      );
  }
  const runs = [
    { id: "run-0", previous: null, anchor: "run-0", mode: "ANCHOR" },
    { id: "run-1", previous: "run-0", anchor: "run-0", mode: "REFERENCE" },
    { id: "run-2", previous: "run-1", anchor: "run-2", mode: "ANCHOR" },
    { id: "run-3", previous: "run-2", anchor: "run-2", mode: "REFERENCE" },
  ] as const;
  for (const [index, run] of runs.entries()) {
    database
      .prepare(
        `INSERT INTO planning_runs
          (id, operation_day_id, operation_day_version, context_id, previous_run_id,
           anchor_run_id, replay_distance, calculation_now, captured_at, trigger_event_type,
           capture_mode, anchor_reason, application_version, requirements_version, source_revision,
           dispatch_plan_revision, forecast_digest, forecast_semantic_digest, precall_digest,
           duration_ms, status, failure_code)
         VALUES (?1, 'event-one', ?2, ?3, ?4, ?5, ?6, ?7, ?7, 'TEST', ?8, ?9,
                 '1.12.0', '1.12.0', 'test', 'dispatch', ?10, ?10, ?10, 1,
                 'SUCCEEDED', NULL)`,
      )
      .run(
        run.id,
        index + 1,
        `context-${index}`,
        run.previous,
        run.anchor,
        run.mode === "ANCHOR" ? 0 : 1,
        times[index],
        run.mode,
        run.mode === "ANCHOR" ? "TEST" : null,
        "f".repeat(64),
      );
  }
}

function environment(input: { d1: D1Database; bucket: R2Bucket; workflow?: Workflow }): Env {
  return {
    APP_ENV: "development",
    DATA_JURISDICTION: "eu",
    DB: input.d1,
    BACKUPS: input.bucket,
    PLANNING_HISTORY_COMPACTION: input.workflow ?? ({} as Workflow),
    PLANNING_DETAIL_RETENTION_HOURS: "24",
    PLANNING_HISTORY_RETENTION_YEARS: "5",
    SOURCE_REVISION: "test-revision",
  } as unknown as Env;
}

describe("planning history compaction", () => {
  beforeAll(() => {
    Object.defineProperty(crypto, "DigestStream", {
      configurable: true,
      value: NodeDigestStream,
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(crypto, "DigestStream");
  });

  it("validates explicit production retention and bounded non-production defaults", () => {
    expect(planningDetailRetentionHours({ APP_ENV: "development" } as Env)).toBe(24);
    expect(planningHistoryRetentionYears({ APP_ENV: "acceptance" } as Env)).toBe(5);
    expect(() => planningDetailRetentionHours({ APP_ENV: "production" } as Env)).toThrow(
      "PLANNING_DETAIL_RETENTION_HOURS_REQUIRED",
    );
    expect(() =>
      planningHistoryRetentionYears({
        APP_ENV: "acceptance",
        PLANNING_HISTORY_RETENTION_YEARS: "4",
      } as Env),
    ).toThrow("PLANNING_HISTORY_RETENTION_YEARS_INVALID");
  });

  it("builds, re-reads and verifies an immutable package before bounded pruning", async () => {
    const database = createD1TestDatabase();
    const storage = memoryBucket();
    seedPlanningHistory(database.database);
    const env = environment({ d1: database.d1, bucket: storage.bucket });

    const ids = await claimPlanningHistoryCompactions(env, new Date("2026-08-16T12:00:00.000Z"));
    expect(ids).toHaveLength(1);
    const id = ids[0] ?? "";
    const pending = database.database
      .prepare(
        `SELECT status, segment_end_run_id, continuation_run_id, expires_at
           FROM planning_history_compactions WHERE id = ?1`,
      )
      .get(id);
    expect(pending).toMatchObject({
      status: "PENDING",
      segment_end_run_id: "run-1",
      continuation_run_id: "run-2",
      expires_at: "2031-08-16T12:00:00.000Z",
    });
    await expect(prunePlanningHistoryBatch(env, id)).resolves.toEqual({
      completed: false,
      deletedRows: 0,
    });
    expect(database.database.prepare("SELECT COUNT(*) AS count FROM planning_runs").get()).toEqual({
      count: 4,
    });

    await expect(buildPlanningHistoryPackage(env, id)).resolves.toBe(true);
    const verified = database.database
      .prepare(
        `SELECT status, object_key, checksum_key, object_sha256, entry_counts_json
           FROM planning_history_compactions WHERE id = ?1`,
      )
      .get(id) as {
      status: string;
      object_key: string;
      checksum_key: string;
      object_sha256: string;
      entry_counts_json: string;
    };
    expect(verified.status).toBe("VERIFIED");
    expect(verified.object_sha256).toMatch(/^[a-f0-9]{64}$/);
    const archive = storage.objects.get(verified.object_key) ?? new Uint8Array();
    const files = unzipSync(archive);
    const manifest = JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array())) as {
      format: string;
      entries: Array<{ path: string; rowCount: number; sha256: string }>;
      continuation: { continuationRunId: string };
    };
    expect(manifest).toMatchObject({
      format: "rundflug-planning-history",
      continuation: { continuationRunId: "run-2" },
    });
    expect(manifest.entries).toHaveLength(4);
    expect(manifest.entries.find((entry) => entry.path === "planning/runs.ndjson")).toMatchObject({
      rowCount: 2,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(storage.objects.has(verified.checksum_key)).toBe(true);

    await expect(prunePlanningHistoryBatch(env, id)).resolves.toMatchObject({
      completed: false,
      deletedRows: 3,
    });
    await expect(prunePlanningHistoryBatch(env, id)).resolves.toEqual({
      completed: false,
      deletedRows: 1,
    });
    await expect(prunePlanningHistoryBatch(env, id)).resolves.toEqual({
      completed: true,
      deletedRows: 0,
    });
    expect(
      database.database
        .prepare("SELECT id FROM planning_runs ORDER BY id")
        .all()
        .map((row: Record<string, unknown>) => row.id),
    ).toEqual(["run-2", "run-3"]);
    expect(
      database.database
        .prepare("SELECT previous_run_id, anchor_run_id FROM planning_runs WHERE id = 'run-2'")
        .get(),
    ).toEqual({ previous_run_id: null, anchor_run_id: null });
    expect(
      database.database
        .prepare("SELECT status FROM planning_history_compactions WHERE id = ?1")
        .get(id),
    ).toEqual({ status: "COMPLETED" });
    expect(planningHistoryPruneLimits).toEqual({
      forecastSnapshots: 10_000,
      planningRuns: 500,
      planningContexts: 250,
      planningChunks: 500,
    });
    database.close();
  });

  it("blocks a segment containing a stale capturing run", async () => {
    const database = createD1TestDatabase();
    const storage = memoryBucket();
    seedPlanningHistory(database.database);
    database.database.exec("DROP TRIGGER planning_runs_restrict_update");
    database.database
      .prepare("UPDATE planning_runs SET status = 'CAPTURING' WHERE id = 'run-1'")
      .run();
    const env = environment({ d1: database.d1, bucket: storage.bucket });

    await expect(
      claimPlanningHistoryCompactions(env, new Date("2026-08-16T12:00:00.000Z")),
    ).resolves.toEqual([]);
    expect(
      database.database.prepare("SELECT COUNT(*) AS count FROM planning_history_compactions").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  it("resumes after the archive upload without overwriting the immutable object", async () => {
    const database = createD1TestDatabase();
    const storage = memoryBucket({ failChecksumOnce: true });
    seedPlanningHistory(database.database);
    const env = environment({ d1: database.d1, bucket: storage.bucket });
    const [id = ""] = await claimPlanningHistoryCompactions(
      env,
      new Date("2026-08-16T12:00:00.000Z"),
    );

    await expect(buildPlanningHistoryPackage(env, id)).rejects.toThrow(
      "SYNTHETIC_CHECKSUM_UPLOAD_FAILURE",
    );
    expect(storage.multipartCompletions()).toBe(1);
    await expect(buildPlanningHistoryPackage(env, id)).resolves.toBe(true);
    expect(storage.multipartCompletions()).toBe(1);
    expect(
      database.database
        .prepare("SELECT status FROM planning_history_compactions WHERE id = ?1")
        .get(id),
    ).toEqual({ status: "VERIFIED" });
    database.close();
  });

  it("keeps contexts that are still referenced by a hot run", async () => {
    const database = createD1TestDatabase();
    const storage = memoryBucket();
    seedPlanningHistory(database.database);
    const source = database.database
      .prepare("SELECT * FROM planning_runs WHERE id = 'run-3'")
      .get() as Record<string, unknown>;
    const hotRun: Record<string, unknown> = {
      ...source,
      id: "run-4",
      operation_day_version: 5,
      context_id: "context-1",
      previous_run_id: "run-3",
      replay_distance: 2,
      calculation_now: "2026-08-16T11:00:00.000Z",
      captured_at: "2026-08-16T11:00:00.000Z",
    };
    const columns = Object.keys(hotRun);
    database.database
      .prepare(
        `INSERT INTO planning_runs (${columns.join(", ")}) VALUES (${columns
          .map((_, index) => `?${index + 1}`)
          .join(", ")})`,
      )
      .run(...columns.map((column) => hotRun[column]));
    const env = environment({ d1: database.d1, bucket: storage.bucket });
    const [id = ""] = await claimPlanningHistoryCompactions(
      env,
      new Date("2026-08-16T12:00:00.000Z"),
    );

    await buildPlanningHistoryPackage(env, id);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await prunePlanningHistoryBatch(env, id)).completed) break;
    }
    expect(
      database.database
        .prepare("SELECT id FROM planning_contexts ORDER BY id")
        .all()
        .map((row: Record<string, unknown>) => row.id),
    ).toEqual(["context-0", "context-1", "context-2", "context-3"]);
    database.close();
  });

  it("compacts the terminal remainder without a continuation anchor", async () => {
    const database = createD1TestDatabase();
    const storage = memoryBucket();
    seedPlanningHistory(database.database);
    database.database
      .prepare(
        `UPDATE operation_days
            SET status = 'ARCHIVED', operations_end_at = ?1, archived_at = ?1, updated_at = ?1
          WHERE id = 'event-one'`,
      )
      .run("2026-08-16T11:00:00.000Z");
    const env = environment({ d1: database.d1, bucket: storage.bucket });
    const [id = ""] = await claimPlanningHistoryCompactions(
      env,
      new Date("2026-08-17T12:00:00.000Z"),
    );
    expect(
      database.database
        .prepare(
          "SELECT terminal_segment, continuation_run_id FROM planning_history_compactions WHERE id = ?1",
        )
        .get(id),
    ).toEqual({ terminal_segment: 1, continuation_run_id: null });

    await buildPlanningHistoryPackage(env, id);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await prunePlanningHistoryBatch(env, id)).completed) break;
    }
    expect(database.database.prepare("SELECT COUNT(*) AS count FROM planning_runs").get()).toEqual({
      count: 0,
    });
    expect(
      database.database
        .prepare("SELECT status FROM planning_history_compactions WHERE id = ?1")
        .get(id),
    ).toEqual({ status: "COMPLETED" });
    database.close();
  });

  it("starts fair idempotent workflow instances with catalogue ids", async () => {
    const database = createD1TestDatabase();
    const storage = memoryBucket();
    seedPlanningHistory(database.database);
    const createBatch = vi.fn(async () => []);
    const env = environment({
      d1: database.d1,
      bucket: storage.bucket,
      workflow: { createBatch } as unknown as Workflow,
    });

    await expect(
      startPlanningHistoryWorkflows(env, new Date("2026-08-16T12:00:00.000Z")),
    ).resolves.toBe(1);
    expect(createBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        id: expect.stringMatching(/^planning-history-/),
        params: { compactionId: expect.stringMatching(/^planning-history-/) },
      }),
    ]);
    await expect(
      startPlanningHistoryWorkflows(env, new Date("2026-08-16T13:00:00.000Z")),
    ).resolves.toBe(0);
    expect(createBatch).toHaveBeenCalledTimes(1);
    database.close();
  });
});
