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
    type: z.literal("SET_EVENT_LIFECYCLE"),
    payload: z.object({
      status: z.enum(["PREPARATION", "ACTIVE", "CLOSED", "ARCHIVED"]),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("STAGE_OUTAGE_RECOVERY"),
    payload: z.object({
      batchId: z.uuid(),
      entries: z
        .array(z.lazy(() => outageRecoveryEntrySchema))
        .min(1)
        .max(500),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("APPROVE_OUTAGE_RECOVERY"),
    payload: z.object({
      batchId: z.uuid(),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("APPLY_OUTAGE_RECOVERY"),
    payload: z.object({
      batchId: z.uuid(),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SELL_TICKET_GROUP"),
    payload: z.object({
      productId: z.string().min(1).max(100),
      publicTicketCodes: z.array(z.string().min(12).max(32)).min(1).max(12),
      ticketDetails: z
        .array(
          z.object({
            weightClass: z.enum(["NOT_CAPTURED", "CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"]),
            individualWeightKg: z.number().min(15).max(250).nullable(),
          }),
        )
        .min(1)
        .max(12)
        .optional(),
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
      pilotId: z.string().min(1).max(100),
    }),
  }),
  commandBaseSchema.extend({
    type: z.enum(["MARK_IN_FLIGHT", "MARK_LANDED", "MARK_COMPLETED"]),
    payload: z.object({ rotationId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.enum(["DEFER_TICKET_GROUP", "MARK_NO_SHOW"]),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CANCEL_TICKET_GROUP"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("REBOOK_TICKET_GROUP"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      newProductId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
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
    type: z.literal("SET_EVENT_INTERRUPTION"),
    payload: z.object({
      interrupted: z.boolean(),
      reason: z.string().trim().min(3).max(240),
      expectedReviewAt: z.iso.datetime().nullable(),
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
    type: z.literal("SET_RESOURCE_GROUP_NOTICE"),
    payload: z.object({
      resourceGroupId: z.string().min(1).max(100),
      note: z.string().trim().max(240),
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
      adminPin: z.string().min(4).max(32),
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
    type: z.literal("SET_PILOT_PAUSE"),
    payload: z.object({
      pilotId: z.string().min(1).max(100),
      paused: z.boolean(),
      reason: z.string().trim().min(3).max(240),
      expectedReviewAt: z.iso.datetime().nullable(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_AIRCRAFT_OPERATIONAL_STATE"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      state: z.enum(["AVAILABLE", "REFUELING", "PAUSED", "INTERRUPTED", "INACTIVE"]),
      reason: z.string().trim().min(3).max(240),
      expectedReviewAt: z.iso.datetime().nullable(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SCHEDULE_AIRCRAFT_REFUEL"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      planned: z.boolean(),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      reminderThreshold: z.number().int().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_PILOT"),
    payload: z.object({
      pilotId: z.uuid(),
      operationalCode: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{2,12}$/),
      operationalNote: z.string().trim().max(240).default(""),
      active: z.boolean(),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("REVOKE_CALL"),
    payload: z.object({ rotationId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("ABORT_ROTATION"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_TICKET_ATTENDANCE"),
    payload: z.object({
      ticketId: z.string().min(1).max(100),
      checkedIn: z.boolean(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CONFIGURE_EVENT_PARAMETERS"),
    payload: z.object({
      saleOpensAt: z.iso.datetime().nullable(),
      operationsEndAt: z.iso.datetime(),
      noShowAfterMinutes: z.number().int().min(1).max(120),
      notificationLeadMinutes: z.number().int().min(1).max(240),
      childReferenceWeightKg: z.number().positive().max(300),
      normalReferenceWeightKg: z.number().positive().max(300),
      heavyReferenceWeightKg: z.number().positive().max(300),
      plannedBoardingMinutes: z.number().int().min(1).max(120),
      plannedDeboardingMinutes: z.number().int().min(1).max(120),
      plannedBufferMinutes: z.number().int().min(0).max(120),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_GATE"),
    payload: z.object({
      gateId: z.string().min(1).max(100),
      label: z.string().trim().min(2).max(80),
      gateType: z.enum(["FLIGHT_LINE", "BOARDING", "DISPLAY_ONLY"]),
      active: z.boolean(),
      sortOrder: z.number().int().min(0).max(1000),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_PRODUCT"),
    payload: z.object({
      productId: z.string().min(1).max(100),
      resourceGroupId: z.string().min(1).max(100),
      gateId: z.string().min(1).max(100),
      name: z.string().trim().min(2).max(100),
      code: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{2,12}$/),
      publicDescription: z.string().trim().max(240),
      priceCents: z.number().int().min(0).max(1_000_000),
      referenceCapacity: z.number().int().min(1).max(100),
      referenceDurationMinutes: z.number().int().min(1).max(600),
      childCompanionRequired: z.boolean(),
      weightClasses: z
        .array(z.enum(["NOT_CAPTURED", "CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"]))
        .min(1),
      sortOrder: z.number().int().min(0).max(1000),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_RESOURCE_GROUP"),
    payload: z.object({
      resourceGroupId: z.string().min(1).max(100),
      name: z.string().trim().min(2).max(100),
      gateId: z.string().min(1).max(100),
      referenceCapacity: z.number().int().min(1).max(100),
      plannedRotationMinutes: z.number().int().min(1).max(600),
      compatibleAircraftTypes: z.array(z.string().trim().min(1).max(80)).max(50),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_AIRCRAFT"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      registration: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{3,16}$/),
      aircraftType: z.string().trim().min(2).max(80),
      passengerSeats: z.number().int().min(1).max(100),
      maximumPassengerPayloadKg: z.number().positive().max(10_000).nullable(),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("ASSIGN_AIRCRAFT_RESOURCE_GROUP"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      resourceGroupId: z.string().min(1).max(100),
      effectiveAt: z.iso.datetime(),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
]);

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

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

export const eventSnapshotSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventDate: z.string(),
  aerodrome: z.string(),
  timeZone: z.string(),
  status: z.enum(["PREPARATION", "ACTIVE", "CLOSED", "ARCHIVED"]),
  archivedAt: z.string().nullable(),
  templateSourceId: z.string().nullable(),
  emergencyMode: z.boolean(),
  operationalInterrupted: z.boolean(),
  version: z.number().int().nonnegative(),
  operationalNote: z.string(),
  saleOpensAt: z.string().nullable(),
  operationsEndAt: z.string().nullable(),
  noShowAfterMinutes: z.number().int().positive(),
  notificationLeadMinutes: z.number().int().positive(),
  referenceWeightsKg: z.object({
    child: z.number().positive(),
    normal: z.number().positive(),
    heavy: z.number().positive(),
  }),
  plannedBoardingMinutes: z.number().int().positive(),
  plannedDeboardingMinutes: z.number().int().positive(),
  plannedBufferMinutes: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;

export const eventCatalogEntrySchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventDate: z.string(),
  aerodrome: z.string(),
  timeZone: z.string(),
  status: z.string(),
  archivedAt: z.string().nullable(),
  templateSourceId: z.string().nullable(),
  version: z.number().int().nonnegative(),
});
export const eventCatalogSchema = z.object({ events: z.array(eventCatalogEntrySchema) });
export type EventCatalogEntry = z.infer<typeof eventCatalogEntrySchema>;
export type EventCatalog = z.infer<typeof eventCatalogSchema>;

export const ticketSearchResultSchema = z.object({
  ticketGroupId: z.string(),
  productId: z.string(),
  productCode: z.string(),
  productName: z.string(),
  groupStatus: z.string(),
  groupSize: z.number().int().positive(),
  queueSequence: z.number().int().positive(),
  standby: z.boolean(),
  soldAt: z.string(),
  communicationNumber: z.number().int().positive().nullable(),
  communicationLabel: z.string().nullable(),
  rotationStatus: z.string().nullable(),
});
export const ticketSearchResponseSchema = z.object({
  results: z.array(ticketSearchResultSchema).max(20),
});
export type TicketSearchResult = z.infer<typeof ticketSearchResultSchema>;
export type TicketSearchResponse = z.infer<typeof ticketSearchResponseSchema>;

export const cloneEventRequestSchema = z.object({
  commandId: z.uuid(),
  expectedSourceVersion: z.number().int().nonnegative(),
  eventId: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  name: z.string().trim().min(3).max(120),
  eventDate: z.iso.date(),
  aerodrome: z.string().trim().min(2).max(120),
  timeZone: z.string().trim().min(3).max(80).default("Europe/Berlin"),
});
export type CloneEventRequest = z.infer<typeof cloneEventRequestSchema>;

export const commandResultSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  event: eventSnapshotSchema,
  eventType: z.string(),
  aggregate: z
    .object({
      type: z.enum([
        "OPERATION_DAY",
        "PRODUCT",
        "RESOURCE_GROUP",
        "DEVICE",
        "AIRCRAFT",
        "PILOT",
        "TICKET",
        "GATE",
        "TICKET_GROUP",
        "ROTATION",
        "RECOVERY_BATCH",
      ]),
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
  code: z.string(),
  name: z.string(),
  publicDescription: z.string(),
  resourceGroupId: z.string(),
  resourceGroupName: z.string(),
  resourceGroupStatus: z.enum(["ACTIVE", "PAUSED", "INTERRUPTED", "ENDED"]),
  resourceGroupOperationalNote: z.string(),
  priceCents: z.number().int().nonnegative(),
  gateId: z.string(),
  gateLabel: z.string(),
  childCompanionRequired: z.boolean(),
  weightClasses: z.array(z.enum(["NOT_CAPTURED", "CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"])),
  sortOrder: z.number().int().nonnegative(),
  saleEnabled: z.boolean(),
  referenceCapacity: z.number().int().positive(),
  referenceDurationMinutes: z.number().int().positive(),
  queuedTickets: z.number().int().nonnegative(),
  resourceGroupOpenTickets: z.number().int().nonnegative(),
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
  pilotId: z.string().nullable(),
  pilotOperationalCode: z.string().nullable(),
  suggestedPilotId: z.string().nullable(),
  suggestedPilotOperationalCode: z.string().nullable(),
  suggestedAircraftId: z.string().nullable(),
  suggestedAircraftRegistration: z.string().nullable(),
  ticketCount: z.number().int().nonnegative(),
  predictedLowerMinutes: z.number().int().nonnegative(),
  predictedUpperMinutes: z.number().int().nonnegative(),
  calledAt: z.string().nullable(),
  timeline: z.object({
    planned: z.object({
      boardingAt: z.string().nullable(),
      departureAt: z.string().nullable(),
      landingAt: z.string().nullable(),
      completionAt: z.string().nullable(),
    }),
    predicted: z.object({
      boardingAt: z.string().nullable(),
      departureAt: z.string().nullable(),
      landingAt: z.string().nullable(),
      completionAt: z.string().nullable(),
    }),
    actual: z.object({
      boardingAt: z.string().nullable(),
      departureAt: z.string().nullable(),
      landingAt: z.string().nullable(),
      completionAt: z.string().nullable(),
    }),
    predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]).nullable(),
    predictionUpdatedAt: z.string().nullable(),
  }),
  tickets: z.array(
    z.object({
      id: z.string(),
      attendanceStatus: z.enum(["NOT_CHECKED_IN", "CHECKED_IN"]),
    }),
  ),
});

export const aircraftOperationalSummarySchema = z.object({
  id: z.string(),
  registration: z.string(),
  aircraftType: z.string(),
  passengerSeats: z.number().int().positive(),
  maximumPassengerPayloadKg: z.number().positive().nullable(),
  operationalState: z.enum([
    "AVAILABLE",
    "BOARDING",
    "IN_FLIGHT",
    "LANDED",
    "TURNAROUND",
    "REFUELING",
    "PAUSED",
    "INTERRUPTED",
    "INACTIVE",
  ]),
  resourceGroupId: z.string(),
  resourceGroupName: z.string(),
  refuelPlanned: z.boolean(),
  rotationsSinceRefuel: z.number().int().nonnegative(),
  refuelReminderThreshold: z.number().int().positive(),
  expectedReviewAt: z.string().nullable(),
});

export const pilotOperationalSummarySchema = z.object({
  id: z.string(),
  operationalCode: z.string(),
  operationalNote: z.string(),
  active: z.boolean(),
  paused: z.boolean(),
  pauseExpectedReviewAt: z.string().nullable(),
  currentRotationId: z.string().nullable(),
  currentCommunicationNumber: z.number().int().positive().nullable(),
});

export const operationBoardSchema = z.object({
  currentDeviceRole: z.enum([
    "CASHIER",
    "FLIGHT_LINE",
    "FLIGHT_LINE_LEAD",
    "FLIGHT_DIRECTOR",
    "ADMIN",
  ]),
  event: eventSnapshotSchema,
  products: z.array(productOperationalSummarySchema),
  rotations: z.array(rotationOperationalSummarySchema),
  aircraft: z.array(aircraftOperationalSummarySchema),
  pilots: z.array(pilotOperationalSummarySchema),
  gates: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      gateType: z.enum(["FLIGHT_LINE", "BOARDING", "DISPLAY_ONLY"]),
      active: z.boolean(),
      sortOrder: z.number().int().nonnegative(),
    }),
  ),
  resourceGroups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["ACTIVE", "PAUSED", "INTERRUPTED", "ENDED"]),
      gateId: z.string(),
      gateLabel: z.string(),
      referenceCapacity: z.number().int().positive(),
      plannedRotationMinutes: z.number().int().positive(),
      compatibleAircraftTypes: z.array(z.string()),
      activeAircraftIds: z.array(z.string()),
    }),
  ),
  metrics: z.object({
    openTickets: z.number().int().nonnegative(),
    soldTickets: z.number().int().nonnegative(),
    completedRotations: z.number().int().nonnegative(),
    activeRotations: z.number().int().nonnegative(),
    averageBoardingMinutes: z.number().nonnegative().nullable(),
    averageFlightMinutes: z.number().nonnegative().nullable(),
    averageTurnaroundMinutes: z.number().nonnegative().nullable(),
    averageRotationMinutes: z.number().nonnegative().nullable(),
    averageWaitMinutes: z.number().nonnegative().nullable(),
    informationalRevenueCents: z.number().int().nonnegative(),
    activeDevices: z.number().int().nonnegative(),
    activePushSubscriptions: z.number().int().nonnegative(),
  }),
});
export type OperationBoard = z.infer<typeof operationBoardSchema>;

export const publicTicketStatusSchema = z.object({
  eventId: z.string(),
  productName: z.string(),
  productCode: z.string(),
  publicDescription: z.string(),
  gateLabel: z.string(),
  communicationNumber: z.number().int().positive(),
  status: z.enum([
    "WAITING",
    "PREPARE",
    "COME_TO_FLIGHT_LINE",
    "BOARDING",
    "IN_FLIGHT",
    "LANDED",
    "COMPLETED",
    "SERVICE_PAUSED",
  ]),
  queuePosition: z.number().int().positive().nullable(),
  waitLowerMinutes: z.number().int().nonnegative(),
  waitUpperMinutes: z.number().int().nonnegative(),
  predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
  message: z.string(),
  operationalNotice: z.string(),
  updatedAt: z.string(),
});
export type PublicTicketStatus = z.infer<typeof publicTicketStatusSchema>;

export const publicBoardSchema = z.object({
  eventName: z.string(),
  emergencyMode: z.boolean(),
  operationalInterrupted: z.boolean(),
  operationalNotice: z.string(),
  updatedAt: z.string(),
  groups: z.array(
    z.object({
      productName: z.string(),
      productCode: z.string(),
      gateLabel: z.string(),
      communicationNumber: z.number().int().positive(),
      ticketLabels: z.array(z.string()).min(1),
      aircraftRegistration: z.string().nullable(),
      status: z.enum([
        "WAITING",
        "COME_TO_FLIGHT_LINE",
        "IN_FLIGHT",
        "LANDED",
        "COMPLETED",
        "SERVICE_PAUSED",
      ]),
      waitLowerMinutes: z.number().int().nonnegative(),
      waitUpperMinutes: z.number().int().nonnegative(),
      operationalNotice: z.string(),
    }),
  ),
  fleet: z.array(
    z.object({
      registration: z.string(),
      status: z.enum([
        "AVAILABLE",
        "BOARDING",
        "IN_FLIGHT",
        "LANDED",
        "TURNAROUND",
        "REFUELING",
        "PAUSED",
        "INTERRUPTED",
        "INACTIVE",
      ]),
      refuelPlanned: z.boolean(),
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
