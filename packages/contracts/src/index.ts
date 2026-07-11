import { z } from "zod";

export const appEnvironmentSchema = z.enum(["development", "acceptance", "production"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

const commandBaseSchema = z.object({
  commandId: z.uuid(),
  eventId: z.string().min(1).max(100),
  deviceId: z.string().min(1).max(100),
  expectedVersion: z.number().int().nonnegative(),
  issuedAt: z.iso.datetime(),
});

export const commandEnvelopeSchema = z.discriminatedUnion("type", [
  commandBaseSchema.extend({
    type: z.literal("SET_OPERATIONAL_NOTE"),
    payload: z.object({
      note: z.string().trim().max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SELL_TICKET_GROUP"),
    payload: z.object({
      productId: z.string().min(1).max(100),
      publicTicketCodes: z.array(z.string().min(12).max(32)).min(1).max(12),
      standby: z.boolean().default(false),
      paymentStatus: z.enum(["UNPAID", "PAID", "WAIVED", "INFORMATIONAL_ONLY"]),
      paymentMethod: z.enum(["CASH", "CARD", "VOUCHER", "OTHER"]).nullable(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CALL_NEXT"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      aircraftId: z.string().min(1).max(100),
    }),
  }),
  commandBaseSchema.extend({
    type: z.enum(["MARK_IN_FLIGHT", "MARK_LANDED", "MARK_COMPLETED"]),
    payload: z.object({ rotationId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.enum(["CANCEL_TICKET_GROUP", "DEFER_TICKET_GROUP", "MARK_NO_SHOW"]),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("REBOOK_TICKET_GROUP"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      newProductId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("TRIGGER_EMERGENCY"),
    payload: z.object({ reason: z.string().trim().min(3).max(240) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CLEAR_EMERGENCY"),
    payload: z.object({
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_RESOURCE_GROUP_STATUS"),
    payload: z.object({
      resourceGroupId: z.string().min(1).max(100),
      status: z.enum(["ACTIVE", "PAUSED", "INTERRUPTED", "ENDED"]),
      reason: z.string().trim().min(3).max(240),
      expectedReviewAt: z.iso.datetime().nullable(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CONFIGURE_PRODUCT_SALES"),
    payload: z.object({
      productId: z.string().min(1).max(100),
      saleEnabled: z.boolean(),
      saleClosesAt: z.iso.datetime().nullable(),
      warningThreshold: z.number().int().nonnegative().max(1000),
      criticalThreshold: z.number().int().nonnegative().max(1000),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("PAIR_DEVICE"),
    payload: z.object({
      pairedDeviceId: z.uuid(),
      label: z.string().trim().min(2).max(80),
      role: z.enum([
        "CASHIER",
        "FLIGHT_LINE",
        "FLIGHT_LINE_LEAD",
        "FLIGHT_DIRECTOR",
        "ADMIN",
        "DISPLAY",
      ]),
      credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("REVOKE_DEVICE"),
    payload: z.object({
      pairedDeviceId: z.string().min(1).max(100),
      adminPin: z.string().min(4).max(32),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("REVOKE_CALL"),
    payload: z.object({ rotationId: z.string().min(1).max(100) }),
  }),
]);

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export const eventSnapshotSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventDate: z.string(),
  timeZone: z.string(),
  status: z.string(),
  emergencyMode: z.boolean(),
  version: z.number().int().nonnegative(),
  operationalNote: z.string(),
  updatedAt: z.string(),
});

export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;

export const commandResultSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  event: eventSnapshotSchema,
  eventType: z.string(),
  aggregate: z
    .object({
      type: z.enum(["OPERATION_DAY", "PRODUCT", "DEVICE", "TICKET_GROUP", "ROTATION"]),
      id: z.string(),
      relatedRotationId: z.string().optional(),
    })
    .optional(),
});
export type CommandResult = z.infer<typeof commandResultSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    currentVersion: z.number().int().nonnegative().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const productOperationalSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  resourceGroupId: z.string(),
  resourceGroupName: z.string(),
  resourceGroupStatus: z.enum(["ACTIVE", "PAUSED", "INTERRUPTED", "ENDED"]),
  priceCents: z.number().int().nonnegative(),
  saleEnabled: z.boolean(),
  referenceCapacity: z.number().int().positive(),
  queuedTickets: z.number().int().nonnegative(),
  estimatedWaitLowerMinutes: z.number().int().nonnegative(),
  estimatedWaitUpperMinutes: z.number().int().nonnegative(),
  remainingSellableSeats: z.number().int().nonnegative(),
  projectedSeats: z.number().int().nonnegative(),
  capacityStatus: z.enum(["AVAILABLE", "LIMITED", "MANUAL_REVIEW", "SOLD_OUT"]),
  saleRecommended: z.boolean(),
  saleClosesAt: z.string().nullable(),
  capacityWarningThreshold: z.number().int().nonnegative(),
  capacityCriticalThreshold: z.number().int().nonnegative(),
  predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
});

export const rotationOperationalSummarySchema = z.object({
  id: z.string(),
  flightGroupId: z.string(),
  communicationNumber: z.number().int().positive(),
  productName: z.string(),
  status: z.enum(["DRAFT", "CALLED", "IN_FLIGHT", "LANDED", "COMPLETED"]),
  ticketGroupId: z.string(),
  aircraftId: z.string().nullable(),
  aircraftRegistration: z.string().nullable(),
  suggestedAircraftId: z.string().nullable(),
  suggestedAircraftRegistration: z.string().nullable(),
  ticketCount: z.number().int().nonnegative(),
  predictedLowerMinutes: z.number().int().nonnegative(),
  predictedUpperMinutes: z.number().int().nonnegative(),
  calledAt: z.string().nullable(),
});

export const operationBoardSchema = z.object({
  event: eventSnapshotSchema,
  products: z.array(productOperationalSummarySchema),
  rotations: z.array(rotationOperationalSummarySchema),
});
export type OperationBoard = z.infer<typeof operationBoardSchema>;

export const publicTicketStatusSchema = z.object({
  productName: z.string(),
  communicationNumber: z.number().int().positive(),
  status: z.enum([
    "WAITING",
    "PREPARE",
    "COME_TO_FLIGHT_LINE",
    "BOARDING",
    "IN_FLIGHT",
    "LANDED",
    "COMPLETED",
  ]),
  queuePosition: z.number().int().positive().nullable(),
  waitLowerMinutes: z.number().int().nonnegative(),
  waitUpperMinutes: z.number().int().nonnegative(),
  predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
  message: z.string(),
  updatedAt: z.string(),
});
export type PublicTicketStatus = z.infer<typeof publicTicketStatusSchema>;

export const publicBoardSchema = z.object({
  eventName: z.string(),
  emergencyMode: z.boolean(),
  updatedAt: z.string(),
  groups: z.array(
    z.object({
      productName: z.string(),
      communicationNumber: z.number().int().positive(),
      status: z.enum(["WAITING", "COME_TO_FLIGHT_LINE", "IN_FLIGHT", "LANDED", "COMPLETED"]),
      waitLowerMinutes: z.number().int().nonnegative(),
      waitUpperMinutes: z.number().int().nonnegative(),
    }),
  ),
});
export type PublicBoard = z.infer<typeof publicBoardSchema>;

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
