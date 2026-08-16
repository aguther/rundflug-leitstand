import { describe, expect, it } from "vitest";
import { analysisArchiveSchema } from "./forecast-analysis";
import {
  planningHistoryCompactionStatusSchema,
  planningHistoryPackageManifestSchema,
} from "./planning-history";

function manifest() {
  return {
    format: "rundflug-planning-history",
    formatVersion: 1,
    createdAt: "2026-08-16T12:00:00.000Z",
    privacyProfile: "SUPPORT_SAFE",
    applicationVersion: "1.12.0",
    requirementsVersion: "1.12.0",
    sourceRevision: "synthetic-revision",
    event: { id: "event-one", date: "2026-08-16" },
    segment: {
      compactionId: "compaction-one",
      startRunId: "run-one",
      startCapturedAt: "2026-08-15T10:00:00.000Z",
      endRunId: "run-two",
      endCapturedAt: "2026-08-15T11:00:00.000Z",
      terminal: false,
    },
    continuation: {
      terminal: false,
      continuationRunId: "run-three",
      continuationContextId: "context-three",
      previousRunId: "run-two",
      anchorRunId: "run-three",
      previousContextId: "context-two",
    },
    continuationReceipt: {
      path: "continuation.json",
      encoding: "json",
      rowCount: 1,
      byteCount: 2,
      sha256: "b".repeat(64),
    },
    entries: [
      "planning/runs.ndjson",
      "planning/contexts.ndjson",
      "planning/chunks.ndjson",
      "history/forecast-snapshots.ndjson",
    ].map((path) => ({
      path,
      encoding: "ndjson",
      rowCount: 0,
      byteCount: 0,
      sha256: "a".repeat(64),
    })),
  } as const;
}

describe("planning history package contracts", () => {
  it("keeps analysis archive versions one and two compatible", () => {
    const archive = {
      id: "archive-one",
      eventId: "event-one",
      eventVersion: 1,
      privacyProfile: "SUPPORT_SAFE",
      formatVersion: 1,
      status: "READY",
      requestedAt: "2026-08-16T12:00:00.000Z",
      startedAt: "2026-08-16T12:01:00.000Z",
      completedAt: "2026-08-16T12:02:00.000Z",
      expiresAt: "2026-09-16T12:00:00.000Z",
      sizeBytes: 123,
      failureCode: null,
    } as const;
    expect(analysisArchiveSchema.safeParse(archive).success).toBe(true);
    expect(analysisArchiveSchema.safeParse({ ...archive, formatVersion: 2 }).success).toBe(true);
    expect(analysisArchiveSchema.safeParse({ ...archive, formatVersion: 3 }).success).toBe(false);
  });

  it("accepts the versioned support-safe manifest and all lifecycle states", () => {
    expect(planningHistoryPackageManifestSchema.parse(manifest())).toEqual(manifest());
    for (const status of [
      "PENDING",
      "BUILDING",
      "VERIFIED",
      "PRUNING",
      "COMPLETED",
      "FAILED",
      "EXPIRED",
      "DELETED",
    ]) {
      expect(planningHistoryCompactionStatusSchema.parse(status)).toBe(status);
    }
  });

  it("rejects unknown formats, extra fields and malformed checksums", () => {
    expect(
      planningHistoryPackageManifestSchema.safeParse({ ...manifest(), formatVersion: 2 }).success,
    ).toBe(false);
    expect(
      planningHistoryPackageManifestSchema.safeParse({
        ...manifest(),
        entries: manifest().entries.map((entry, index) =>
          index === 0 ? { ...entry, sha256: "not-a-checksum" } : entry,
        ),
      }).success,
    ).toBe(false);
    expect(
      planningHistoryPackageManifestSchema.safeParse({ ...manifest(), unsafePayload: true })
        .success,
    ).toBe(false);
  });
});
