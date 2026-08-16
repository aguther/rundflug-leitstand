import { z } from "zod";
import { dispatchDecisionDetailsSchema } from "./dispatch-decision-details";

const outageRecoveryEntryBaseSchema = z
  .object({
    id: z.uuid(),
    originalOccurredAt: z.iso.datetime(),
    paperSequence: z.number().int().positive(),
    paperReference: z.string().trim().min(3).max(64),
  })
  .strict();

export const outageRecoveryEntrySchema = z.discriminatedUnion("type", [
  outageRecoveryEntryBaseSchema.extend({
    type: z.literal("PAPER_SALE"),
    payload: z
      .object({
        productId: z.string().min(1).max(100),
        publicGroupCode: z
          .string()
          .regex(/^[A-Z2-9]{12,32}$/)
          .optional(),
        publicTicketCodes: z
          .array(z.string().regex(/^[A-Z2-9]{12,32}$/))
          .min(1)
          .max(12),
        paymentStatus: z.enum(["UNPAID", "PAID", "WAIVED", "INFORMATIONAL_ONLY"]),
        paymentMethod: z.enum(["CASH", "CARD", "VOUCHER", "OTHER"]).nullable(),
      })
      .strict(),
  }),
  outageRecoveryEntryBaseSchema.extend({
    type: z.literal("ROTATION_CALLED"),
    payload: z
      .object({
        aircraftId: z.string().min(1).max(100),
        pilotId: z.string().min(1).max(100),
      })
      .strict(),
  }),
  outageRecoveryEntryBaseSchema.extend({
    type: z.enum(["ROTATION_IN_FLIGHT", "ROTATION_LANDED", "ROTATION_COMPLETED"]),
    payload: z.object({}).strict(),
  }),
]);
export type OutageRecoveryEntryContract = z.infer<typeof outageRecoveryEntrySchema>;

export const storedOutagePaperSalePayloadSchema = z
  .object({
    productId: z.string().min(1).max(100),
    publicGroupCodeHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    publicTicketCodeHashes: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(12),
    paymentStatus: z.enum(["UNPAID", "PAID", "WAIVED", "INFORMATIONAL_ONLY"]),
    paymentMethod: z.enum(["CASH", "CARD", "VOUCHER", "OTHER"]).nullable(),
  })
  .strict();
export const storedOutageCallPayloadSchema = z
  .object({
    aircraftId: z.string().min(1).max(100),
    pilotId: z.string().min(1).max(100),
  })
  .strict();
export const storedOutageTransitionPayloadSchema = z.object({}).strict();

export const stageOutageRecoveryRequestSchema = z
  .object({
    batchId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    entries: z.array(outageRecoveryEntrySchema).min(1).max(500),
  })
  .strict();
export type StageOutageRecoveryRequest = z.infer<typeof stageOutageRecoveryRequestSchema>;

export const outageRecoveryConflictSchema = z.object({
  entryId: z.string(),
  code: z.enum([
    "DUPLICATE_ENTRY_ID",
    "DUPLICATE_PAPER_SEQUENCE",
    "EVENT_IN_FUTURE",
    "PAPER_REFERENCE_ALREADY_EXISTS",
    "PAPER_REFERENCE_UNKNOWN",
    "RECOVERY_TRANSITION_INVALID",
    "DUPLICATE_TICKET_CODE",
    "TICKET_CODE_ALREADY_EXISTS",
  ]),
  message: z.string(),
});

export const outageRecoverySimulationSchema = z.object({
  batchId: z.uuid(),
  simulatedAgainstVersion: z.number().int().nonnegative(),
  canCommit: z.boolean(),
  orderedEntryIds: z.array(z.uuid()),
  conflicts: z.array(outageRecoveryConflictSchema),
});
export type OutageRecoverySimulation = z.infer<typeof outageRecoverySimulationSchema>;

export const auditEntrySchema = z.object({
  sequence: z.number().int().positive(),
  eventType: z.string(),
  occurredAt: z.string(),
  deviceId: z.string(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  aggregateVersion: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});
export const auditHistorySchema = z.object({ entries: z.array(auditEntrySchema) });
export type AuditHistory = z.infer<typeof auditHistorySchema>;

const ticketHistoryStatusSchema = z.enum([
  "QUEUED",
  "CHECKED_IN",
  "CALLED",
  "BOARDING",
  "IN_FLIGHT",
  "LANDED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELED",
  "CLARIFICATION",
]);
const rotationHistoryStatusSchema = z.enum([
  "DRAFT",
  "CALLED",
  "IN_FLIGHT",
  "LANDED",
  "COMPLETED",
  "CANCELED",
]);

export const operationalHistoryQuerySchema = z
  .object({
    ticketId: z.string().trim().min(1).max(100).optional(),
    ticketGroupId: z.string().trim().min(1).max(100).optional(),
    rotationId: z.string().trim().min(1).max(100).optional(),
    flightGroupId: z.string().trim().min(1).max(100).optional(),
    aircraftId: z.string().trim().min(1).max(100).optional(),
    pilotId: z.string().trim().min(1).max(100).optional(),
    productId: z.string().trim().min(1).max(100).optional(),
    resourceGroupId: z.string().trim().min(1).max(100).optional(),
    gateId: z.string().trim().min(1).max(100).optional(),
    communicationNumber: z.coerce.number().int().positive().optional(),
    ticketStatus: ticketHistoryStatusSchema.optional(),
    rotationStatus: rotationHistoryStatusSchema.optional(),
    since: z.iso.datetime().optional(),
    until: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict()
  .refine(
    (query) => !query.since || !query.until || Date.parse(query.since) <= Date.parse(query.until),
    { message: "Der Beginn des Zeitraums muss vor seinem Ende liegen.", path: ["since"] },
  );
export type OperationalHistoryQuery = z.infer<typeof operationalHistoryQuerySchema>;

export const operationalHistoryEntrySchema = z.object({
  ticketId: z.string(),
  ticketGroupId: z.string(),
  ticketStatus: ticketHistoryStatusSchema,
  soldAt: z.string(),
  assignmentActive: z.boolean(),
  assignedAt: z.string().nullable(),
  releasedAt: z.string().nullable(),
  rotationId: z.string().nullable(),
  rotationStatus: rotationHistoryStatusSchema.nullable(),
  flightGroupId: z.string().nullable(),
  communicationNumber: z.number().int().positive().nullable(),
  communicationLabel: z.string().nullable(),
  productId: z.string(),
  productCode: z.string(),
  productName: z.string(),
  resourceGroupId: z.string(),
  resourceGroupName: z.string(),
  gateId: z.string().nullable(),
  gateLabel: z.string().nullable(),
  aircraftId: z.string().nullable(),
  aircraftRegistration: z.string().nullable(),
  pilotId: z.string().nullable(),
  pilotOperationalCode: z.string().nullable(),
  calledAt: z.string().nullable(),
  departedAt: z.string().nullable(),
  landedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  latestAt: z.string(),
});
export const operationalHistorySchema = z.object({
  entries: z.array(operationalHistoryEntrySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type OperationalHistory = z.infer<typeof operationalHistorySchema>;

export const forecastHistoryQuerySchema = z
  .object({
    rotationId: z.string().trim().min(1).max(100).optional(),
    aircraftId: z.string().trim().min(1).max(100).optional(),
    pilotId: z.string().trim().min(1).max(100).optional(),
    since: z.iso.datetime().optional(),
    until: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict()
  .refine(
    (query) => !query.since || !query.until || Date.parse(query.since) <= Date.parse(query.until),
    { message: "Der Beginn des Zeitraums muss vor seinem Ende liegen.", path: ["since"] },
  );
export type ForecastHistoryQuery = z.infer<typeof forecastHistoryQuerySchema>;

const nullableTimestampSchema = z.string().nullable();
const nullableDeviationSchema = z.number().nullable();
export const forecastHistoryEntrySchema = z.object({
  snapshotId: z.string(),
  rotationId: z.string(),
  flightGroupId: z.string(),
  communicationNumber: z.number().int().positive(),
  communicationLabel: z.string(),
  aircraftId: z.string().nullable(),
  aircraftRegistration: z.string().nullable(),
  pilotId: z.string().nullable(),
  pilotOperationalCode: z.string().nullable(),
  operationDayVersion: z.number().int().nonnegative(),
  capturedAt: z.string(),
  triggerEventType: z.string(),
  quality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
  lowerMinutes: z.number().int().nonnegative(),
  upperMinutes: z.number().int().nonnegative(),
  dataBasisScope: z.enum([
    "AIRCRAFT_PRODUCT_HISTORY",
    "PRODUCT_HISTORY",
    "REFERENCE_ONLY",
    "LEGACY_UNKNOWN",
  ]),
  sampleSize: z.number().int().nonnegative(),
  dataAgeMinutes: z.number().nonnegative(),
  activeCapacity: z.number().int().nonnegative(),
  // Vollständige Referenz-Umlaufzeit einschließlich veranstaltungsweiter Bodenzeiten.
  referenceDurationMinutes: z.number().int().nonnegative(),
  productId: z.string().nullable(),
  assumedAircraftId: z.string().nullable(),
  turnaroundProfile: z.object({
    boardingMinutes: z.number().int().nonnegative().nullable(),
    deboardingMinutes: z.number().int().nonnegative().nullable(),
    bufferMinutes: z.number().int().nonnegative().nullable(),
    boardingSource: z.string(),
    deboardingSource: z.string(),
    bufferSource: z.string(),
  }),
  dispatchPlan: z
    .object({
      planId: z.string().nullable(),
      revision: z.string().nullable(),
      batchId: z.string().nullable(),
      dispatchOrder: z.number().int().positive().nullable(),
      wave: z.number().int().positive().nullable(),
      laneId: z.string().nullable(),
      groupIds: z.array(z.string()),
      occupiedSeats: z.number().int().positive().nullable(),
      availableSeats: z.number().int().nonnegative().nullable(),
      commitmentLevel: z.enum(["WAITING", "PREPARE", "COME_TO_FLIGHT_LINE"]).nullable(),
      decisionReasons: z.array(z.string()),
      decisionDetails: dispatchDecisionDetailsSchema.nullable().optional(),
      confirmedOvertakeCount: z.number().int().nonnegative().default(0),
      projectedOvertakeCount: z.number().int().nonnegative(),
      unplannedReason: z
        .enum([
          "NO_FORECAST_CAPACITY",
          "WAITING_FOR_FITTING_LANE",
          "WAITING_FOR_PRODUCT_FAIRNESS",
          "NOT_IN_NEAR_DISPATCH_BATCH",
          "COMMITMENT_LOCKED",
          "ATTENDANCE_MISSING",
          "ATTENDANCE_CLARIFICATION",
          "UNKNOWN_RESOURCE_RETURN",
        ])
        .nullable(),
    })
    .default({
      planId: null,
      revision: null,
      batchId: null,
      dispatchOrder: null,
      wave: null,
      laneId: null,
      groupIds: [],
      occupiedSeats: null,
      availableSeats: null,
      commitmentLevel: null,
      decisionReasons: [],
      decisionDetails: null,
      confirmedOvertakeCount: 0,
      projectedOvertakeCount: 0,
      unplannedReason: null,
    }),
  predicted: z.object({
    boardingAt: nullableTimestampSchema,
    departureAt: nullableTimestampSchema,
    landingAt: nullableTimestampSchema,
    completionAt: nullableTimestampSchema,
  }),
  actual: z.object({
    boardingAt: nullableTimestampSchema,
    departureAt: nullableTimestampSchema,
    landingAt: nullableTimestampSchema,
    completionAt: nullableTimestampSchema,
  }),
  deviationMinutes: z.object({
    boarding: nullableDeviationSchema,
    departure: nullableDeviationSchema,
    landing: nullableDeviationSchema,
    completion: nullableDeviationSchema,
  }),
});
export const forecastHistorySchema = z.object({
  entries: z.array(forecastHistoryEntrySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ForecastHistory = z.infer<typeof forecastHistorySchema>;

export const resourceDayHistoryQuerySchema = z
  .object({
    scopeType: z.enum(["AIRCRAFT", "PILOT"]),
    scopeId: z.string().trim().min(1).max(100),
  })
  .strict();
export type ResourceDayHistoryQuery = z.infer<typeof resourceDayHistoryQuerySchema>;

const resourceDayActualTimelineSchema = z.object({
  boardingAt: nullableTimestampSchema,
  departureAt: nullableTimestampSchema,
  landingAt: nullableTimestampSchema,
  completionAt: nullableTimestampSchema,
});

export const resourceDayRotationSchema = z
  .object({
    rotationId: z.string(),
    flightGroupId: z.string(),
    communicationNumber: z.number().int().positive(),
    communicationLabel: z.string(),
    resourceGroupId: z.string(),
    resourceGroupName: z.string(),
    productName: z.string(),
    passengerCount: z.number().int().nonnegative(),
    usableCapacity: z.number().int().positive(),
    aircraftId: z.string().nullable(),
    aircraftRegistration: z.string().nullable(),
    pilotId: z.string().nullable(),
    pilotOperationalCode: z.string().nullable(),
    actual: resourceDayActualTimelineSchema,
  })
  .strict();

export const resourceDayBlockSchema = z
  .object({
    id: z.string(),
    type: z.enum(["REFUELING", "PAUSE", "INTERRUPTION"]),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    active: z.boolean(),
  })
  .strict();

export const resourceDayHistorySchema = z
  .object({
    scopeType: z.enum(["AIRCRAFT", "PILOT"]),
    scopeId: z.string(),
    from: z.string(),
    until: z.string(),
    observedUntil: z.string(),
    rotations: z.array(resourceDayRotationSchema),
    blocks: z.array(resourceDayBlockSchema),
  })
  .strict();
export type ResourceDayHistory = z.infer<typeof resourceDayHistorySchema>;
