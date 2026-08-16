import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  createPortableBackup,
  operationDateInTimeZone,
  portableBackupLimits,
  serializePortableBackup,
} from "./backup";
import type { Env } from "./types";

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
        resolveDigest(
          await crypto.subtle.digest("SHA-256", stableArrayBuffer(concatenate(chunks))),
        );
      },
    });
    this.digest = digest;
  }
}

type SyntheticRowSource = {
  count: number;
  row: (index: number) => Record<string, unknown>;
};

function fakeDatabase(
  sources: Partial<Record<(typeof BACKUP_TABLES)[number], SyntheticRowSource>>,
  pageLimits: number[] = [],
) {
  return {
    prepare(sql: string) {
      const table = BACKUP_TABLES.find((candidate) => sql.includes(`FROM ${candidate}`));
      if (!table) throw new Error(`Unexpected SQL: ${sql}`);
      const source = sources[table] ?? { count: 0, row: () => ({}) };
      return {
        async first() {
          return { row_count: source.count };
        },
        bind(limit: number, offset: number) {
          pageLimits.push(limit);
          return {
            async all() {
              const length = Math.max(0, Math.min(limit, source.count - offset));
              return {
                results: Array.from({ length }, (_, index) => source.row(offset + index)),
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
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

function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  const metadata = new Map<string, Record<string, string>>();
  const multipartPartSizes: number[] = [];
  return {
    bucket: {
      async createMultipartUpload(key: string, options: R2MultipartOptions) {
        const parts = new Map<number, Uint8Array>();
        return {
          async abort() {
            parts.clear();
          },
          async complete(uploaded: R2UploadedPart[]) {
            const bytes = concatenate(
              uploaded.map((part) => parts.get(part.partNumber) ?? new Uint8Array()),
            );
            objects.set(key, bytes);
            metadata.set(key, options.customMetadata ?? {});
            return {
              etag: "synthetic-etag",
              key,
              size: bytes.byteLength,
              uploaded: new Date("2026-08-11T09:00:00.000Z"),
            } as R2Object;
          },
          async uploadPart(partNumber: number, value: Uint8Array) {
            const bytes = value.slice();
            parts.set(partNumber, bytes);
            multipartPartSizes.push(bytes.byteLength);
            return { etag: `part-${partNumber}`, partNumber };
          },
        } as R2MultipartUpload;
      },
      async delete() {},
      async list() {
        return { objects: [], truncated: false };
      },
      async put(key: string, value: string, options: R2PutOptions) {
        objects.set(key, new TextEncoder().encode(value));
        metadata.set(key, options.customMetadata ?? {});
        return {
          etag: "synthetic-sidecar-etag",
          key,
          size: value.length,
          uploaded: new Date("2026-08-11T09:00:00.000Z"),
        } as R2Object;
      },
    } as unknown as R2Bucket,
    metadata,
    multipartPartSizes,
    objects,
  };
}

function deterministicNoise(seed: number, length: number): string {
  let state = seed || 1;
  let output = "";
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output += String.fromCharCode(33 + ((state >>> 0) % 90));
  }
  return output;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", stableArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("portable backup format", () => {
  beforeAll(() => {
    Object.defineProperty(crypto, "DigestStream", {
      configurable: true,
      value: NodeDigestStream,
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(crypto, "DigestStream");
  });

  it("contains an explicit version and no implicit guest-name field", () => {
    const serialized = serializePortableBackup({
      format: "rundflug-leitstand-portable-backup",
      formatVersion: 1,
      createdAt: "2026-07-11T02:15:00.000Z",
      applicationVersion: "1.11.0",
      requirementsVersion: "1.11.0",
      reason: "DAILY",
      tables: { tickets: [{ id: "synthetic-ticket", status: "QUEUED" }] },
    });
    expect(JSON.parse(serialized)).toMatchObject({
      formatVersion: 1,
      applicationVersion: "1.11.0",
      requirementsVersion: "1.11.0",
    });
    expect(serialized).not.toContain("guestName");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("pilotName");
  });

  it("calculates the next Berlin operation date safely across daylight-saving changes", () => {
    expect(operationDateInTimeZone(new Date("2026-03-29T01:30:00.000Z"))).toBe("2026-03-29");
    expect(operationDateInTimeZone(new Date("2026-10-25T01:30:00.000Z"))).toBe("2026-10-25");
  });

  it("includes every operational V1 table but excludes ephemeral push credentials", () => {
    expect(BACKUP_TABLES).toEqual(
      expect.arrayContaining([
        "gates",
        "aircraft_product_turnaround_overrides",
        "forecast_snapshots",
        "planning_chunks",
        "planning_contexts",
        "planning_runs",
        "planning_history_compactions",
        "planning_history_compaction_events",
        "analysis_archives",
        "analysis_archive_events",
        "outage_recovery_batches",
        "outage_recovery_entries",
        "outage_recovery_references",
        "app_bootstrap",
        "rotation_manifest_corrections",
        "planned_operational_constraints",
        "recurring_operational_rules",
      ]),
    );
    expect(BACKUP_TABLES).not.toContain("web_push_subscriptions");
    expect(BACKUP_TABLES).not.toContain("planning_history_maintenance_control");
  });

  it("preserves gate travel lead and dispatch planning columns without reinterpretation", () => {
    const serialized = serializePortableBackup({
      format: "rundflug-leitstand-portable-backup",
      formatVersion: 1,
      createdAt: "2026-08-01T08:00:00.000Z",
      applicationVersion: "1.11.0",
      requirementsVersion: "1.11.0",
      reason: "PRE_EVENT",
      tables: {
        gates: [{ id: "gate-1", travel_lead_minutes: 7 }],
        rotations: [{ id: "rotation-1", dispatch_plan_revision: "dispatch-v1" }],
      },
    });
    expect(JSON.parse(serialized).tables).toMatchObject({
      gates: [{ travel_lead_minutes: 7 }],
      rotations: [{ dispatch_plan_revision: "dispatch-v1" }],
    });
  });

  it("streams a version-two manifest and table files with an archive checksum sidecar", async () => {
    const storage = fakeBucket();
    const db = fakeDatabase({
      gates: {
        count: 1,
        row: () => ({ id: "gate-1", travel_lead_minutes: 7 }),
      },
      operational_events: {
        count: 2,
        row: (index) => ({ id: `event-${index + 1}`, payload_json: "{}" }),
      },
    });
    const result = await createPortableBackup(
      { BACKUPS: storage.bucket, DB: db } as Env,
      new Date("2026-08-11T09:15:00.000Z"),
      "PRE_EVENT",
    );

    expect(result.key).toBe("backups/2026-08-11/2026-08-11T09-15-00.000Z.zip");
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    const archive = storage.objects.get(result.key) ?? new Uint8Array();
    expect(await sha256Hex(archive)).toBe(result.checksum);
    const files = unzipSync(archive);
    const manifest = JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array())) as {
      formatVersion: number;
      tables: Array<{ name: string; path: string; rowCount: number }>;
    };
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.tables).toHaveLength(BACKUP_TABLES.length);
    expect(manifest.tables.find((table) => table.name === "operational_events")).toMatchObject({
      path: "tables/operational_events.ndjson",
      rowCount: 2,
    });
    expect(strFromU8(files["tables/operational_events.ndjson"] ?? new Uint8Array())).toContain(
      '"id":"event-2"',
    );
    const checksumKey = `${result.key}.sha256`;
    expect(strFromU8(storage.objects.get(checksumKey) ?? new Uint8Array())).toContain(
      result.checksum,
    );
    expect(storage.metadata.get(result.key)).toMatchObject({
      checksumAlgorithm: "SHA-256",
      checksumKey,
      formatVersion: "2",
    });
    expect(storage.metadata.get(checksumKey)?.sha256).toBe(result.checksum);
  });

  it("uses bounded pages and multipart upload for large audit, forecast, and outbox data", async () => {
    const storage = fakeBucket();
    const pageLimits: number[] = [];
    const rowCount = 12_000;
    const largeSource = (prefix: string): SyntheticRowSource => ({
      count: rowCount,
      row: (index) => ({
        id: `${prefix}-${index}`,
        payload_json: deterministicNoise(index + prefix.length * 10_000, 512),
      }),
    });
    const db = fakeDatabase(
      {
        forecast_snapshots: largeSource("forecast"),
        operational_events: largeSource("audit"),
        outbox: largeSource("outbox"),
      },
      pageLimits,
    );

    const result = await createPortableBackup(
      { BACKUPS: storage.bucket, DB: db } as Env,
      new Date("2026-08-11T10:00:00.000Z"),
      "DAILY",
    );

    expect(storage.multipartPartSizes.length).toBeGreaterThan(1);
    expect(storage.multipartPartSizes.slice(0, -1)).toEqual(
      expect.arrayContaining([5 * 1024 * 1024]),
    );
    expect(Math.max(...storage.multipartPartSizes)).toBe(5 * 1024 * 1024);
    expect(storage.objects.get(result.key)?.byteLength).toBeGreaterThan(5 * 1024 * 1024);
    expect(portableBackupLimits.pageSize).toBe(500);
    expect(new Set(pageLimits)).toEqual(new Set([portableBackupLimits.pageSize]));
  }, 15_000);
});
