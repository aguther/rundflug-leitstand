import { z } from "zod";

export const planningHistoryCompactionStatusSchema = z.enum([
  "PENDING",
  "BUILDING",
  "VERIFIED",
  "PRUNING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "DELETED",
]);
export type PlanningHistoryCompactionStatus = z.infer<typeof planningHistoryCompactionStatusSchema>;

export const planningHistoryPackageEntrySchema = z
  .object({
    path: z.string().min(1),
    encoding: z.enum(["json", "ndjson"]),
    rowCount: z.number().int().nonnegative(),
    byteCount: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PlanningHistoryPackageEntry = z.infer<typeof planningHistoryPackageEntrySchema>;

export const planningHistoryContinuationSchema = z
  .object({
    terminal: z.boolean(),
    continuationRunId: z.string().nullable(),
    continuationContextId: z.string().nullable(),
    previousRunId: z.string().nullable(),
    anchorRunId: z.string().nullable(),
    previousContextId: z.string().nullable(),
  })
  .strict();
export type PlanningHistoryContinuation = z.infer<typeof planningHistoryContinuationSchema>;

export const planningHistoryPackageManifestSchema = z
  .object({
    format: z.literal("rundflug-planning-history"),
    formatVersion: z.literal(1),
    createdAt: z.string().datetime(),
    privacyProfile: z.literal("SUPPORT_SAFE"),
    applicationVersion: z.string().min(1),
    requirementsVersion: z.string().min(1),
    sourceRevision: z.string().min(1),
    event: z
      .object({
        id: z.string().min(1),
        date: z.string().min(1),
      })
      .strict(),
    segment: z
      .object({
        compactionId: z.string().min(1),
        startRunId: z.string().min(1),
        startCapturedAt: z.string().datetime(),
        endRunId: z.string().min(1),
        endCapturedAt: z.string().datetime(),
        terminal: z.boolean(),
      })
      .strict(),
    continuation: planningHistoryContinuationSchema,
    continuationReceipt: planningHistoryPackageEntrySchema.extend({
      path: z.literal("continuation.json"),
      encoding: z.literal("json"),
      rowCount: z.literal(1),
    }),
    entries: z.array(planningHistoryPackageEntrySchema).length(4),
  })
  .strict();
export type PlanningHistoryPackageManifest = z.infer<typeof planningHistoryPackageManifestSchema>;
