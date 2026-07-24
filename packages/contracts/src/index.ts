import { z } from "zod";

export const appEnvironmentSchema = z.enum(["development", "acceptance", "production"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export const timeZoneSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: "Ungültige IANA-Zeitzone" },
  );

export const gateDisplayFilterSchema = z
  .object({
    productIds: z
      .array(z.string().min(1).max(100))
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        "Produktfilter enthält Duplikate",
      ),
    rotationStatuses: z
      .array(z.enum(["DRAFT", "CALLED", "IN_FLIGHT", "LANDED", "COMPLETED"]))
      .max(5)
      .refine((values) => new Set(values).size === values.length, "Statusfilter enthält Duplikate"),
  })
  .strict();
export type GateDisplayFilter = z.infer<typeof gateDisplayFilterSchema>;

const productWeightClassSchema = z.enum(["NOT_CAPTURED", "CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"]);

const upsertProductPayloadSchema = z
  .object({
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
    promisedFlightMinutes: z.number().int().min(1).max(600),
    childCompanionRequired: z.boolean(),
    weightClasses: z
      .array(productWeightClassSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length, {
        message: "Gewichtsklassen dürfen nicht doppelt vorkommen.",
      }),
    sortOrder: z.number().int().min(0).max(1000),
    reason: z.string().trim().min(3).max(240),
    adminPin: z.string().min(4).max(32),
  })
  .superRefine((payload, context) => {
    if (payload.weightClasses.includes("NOT_CAPTURED") && payload.weightClasses.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Keine Gewichtserfassung kann nicht mit Gewichtsklassen kombiniert werden.",
        path: ["weightClasses"],
      });
    }
    if (payload.childCompanionRequired && !payload.weightClasses.includes("CHILD")) {
      context.addIssue({
        code: "custom",
        message: "Der Begleithinweis setzt die Gewichtsklasse Kind voraus.",
        path: ["childCompanionRequired"],
      });
    }
  });

export const commandPreconditionSchema = z
  .object({
    aggregateType: z.enum(["ROTATION", "AIRCRAFT"]),
    aggregateId: z.string().min(1).max(100),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type CommandPrecondition = z.infer<typeof commandPreconditionSchema>;

const commandBaseSchema = z.object({
  commandId: z.uuid(),
  eventId: z.string().min(1).max(100),
  deviceId: z.string().min(1).max(100),
  expectedVersion: z.number().int().nonnegative(),
  observedEventVersion: z.number().int().nonnegative().optional(),
  preconditions: z.array(commandPreconditionSchema).length(1).optional(),
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
    type: z.literal("SET_ROTATION_NOTE"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      note: z.string().trim().max(240),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_ROTATION_CAPACITY"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      usableCapacity: z.number().int().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
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
      publicGroupCode: z
        .string()
        .regex(/^[A-Z2-9]{12,32}$/)
        .optional(),
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
      oversizeSplitAcknowledged: z.boolean().default(false),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("ASSIGN_AIRCRAFT_PILOT"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      pilotId: z.string().min(1).max(100),
      reassign: z.boolean(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CALL_NEXT"),
    payload: z.object({
      ticketGroupIds: z.array(z.string().min(1).max(100)).min(1).max(12),
      aircraftId: z.string().min(1).max(100),
      pilotId: z.string().min(1).max(100),
    }),
  }),
  commandBaseSchema.extend({
    type: z.enum(["MARK_OFF_BLOCK", "MARK_ON_BLOCK"]),
    payload: z.object({ rotationId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("COMPLETE_TURNAROUND"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      nextAircraftState: z.enum(["AVAILABLE", "REFUELING", "PAUSED", "INACTIVE"]),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CANCEL_ROTATION"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
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
    type: z.literal("MOVE_TICKET_GROUP"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      targetRotationId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CORRECT_ROTATION_MANIFEST"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      targetRotationId: z.string().min(1).max(100),
      reason: z.string().trim().min(10).max(500),
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
    payload: z
      .object({
        interrupted: z.boolean(),
        reason: z.string().trim().min(3).max(240),
        expectedReviewAt: z.iso.datetime().nullable(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_RESOURCE_GROUP_STATUS"),
    payload: z
      .object({
        resourceGroupId: z.string().min(1).max(100),
        status: z.enum(["ACTIVE", "PAUSED", "INTERRUPTED", "ENDED"]),
        reason: z.string().trim().min(3).max(240),
        expectedReviewAt: z.iso.datetime().nullable(),
      })
      .strict(),
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
      role: z.enum(["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]),
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
    payload: z
      .object({
        pilotId: z.string().min(1).max(100),
        paused: z.boolean(),
        reason: z.string().trim().min(3).max(240),
        expectedReviewAt: z.iso.datetime().nullable(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_AIRCRAFT_OPERATIONAL_STATE"),
    payload: z
      .object({
        aircraftId: z.string().min(1).max(100),
        state: z.enum(["AVAILABLE", "REFUELING", "PAUSED", "INTERRUPTED", "INACTIVE"]),
        reason: z.string().trim().min(3).max(240),
        expectedReviewAt: z.iso.datetime().nullable(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("SCHEDULE_AIRCRAFT_REFUEL"),
    payload: z
      .object({
        aircraftId: z.string().min(1).max(100),
        planned: z.boolean(),
        reason: z.string().trim().min(3).max(240),
      })
      .strict(),
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
    type: z.literal("ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      expectedRotationVersion: z.number().int().nonnegative(),
      expectedAircraftVersion: z.number().int().nonnegative(),
      reason: z.string().trim().min(3).max(500),
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
    type: z.literal("SET_TICKET_GROUP_ATTENDANCE"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      checkedIn: z.boolean(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("MARK_TICKET_GROUP_MISSING"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("RECALL_TICKET_GROUP"),
    payload: z.object({ ticketGroupId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("MARK_TICKET_NO_SHOW"),
    payload: z.object({
      ticketId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CONFIRM_ATTENDANCE_DECISION"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      decision: z.enum(["FLY_WITH_PRESENT", "LEAVE_SEAT_EMPTY"]),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CONFIGURE_EVENT_PARAMETERS"),
    payload: z.object({
      saleOpensAt: z.iso.datetime().nullable(),
      operationsEndAt: z.iso.datetime(),
      noShowAfterMinutes: z.number().int().min(1).max(120),
      maxTicketDeferrals: z.number().int().min(1).max(10).default(2),
      notificationLeadMinutes: z.number().int().min(1).max(240),
      automaticPrecallEnabled: z.boolean().default(true),
      precallLeadMinutes: z.number().int().min(1).max(240).default(15),
      maximumGateWaitMinutes: z.number().int().min(1).max(120).default(20),
      precallMinimumQuality: z.enum(["STABLE", "CHANGING"]).default("CHANGING"),
      precallGateCooldownMinutes: z.number().int().min(0).max(60).default(2),
      childReferenceWeightKg: z.number().positive().max(300),
      normalReferenceWeightKg: z.number().positive().max(300),
      heavyReferenceWeightKg: z.number().positive().max(300),
      plannedBoardingMinutes: z.number().int().min(1).max(120),
      plannedDeboardingMinutes: z.number().int().min(1).max(120),
      plannedBufferMinutes: z.number().int().min(0).max(120),
      departedVisibilitySeconds: z.number().int().min(5).max(900).default(15),
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
      displayFilter: gateDisplayFilterSchema.optional(),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_PRODUCT"),
    payload: upsertProductPayloadSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_RESOURCE_GROUP"),
    payload: z.object({
      resourceGroupId: z.string().min(1).max(100),
      name: z.string().trim().min(2).max(100),
      shortCode: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{2,8}$/),
      gateId: z.string().min(1).max(100),
      referenceCapacity: z.number().int().min(1).max(100),
      plannedRotationMinutes: z.number().int().min(1).max(600),
      compatibleAircraftTypes: z.array(z.string().trim().min(1).max(80)).max(50),
      automaticPrecallEnabled: z.boolean().default(true),
      aircraftIds: z.array(z.string().min(1).max(100)).max(100).optional(),
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
  commandBaseSchema.extend({
    type: z.literal("DELETE_MASTER_DATA"),
    payload: z
      .object({
        entityType: z.enum([
          "GATE",
          "RESOURCE_GROUP",
          "AIRCRAFT",
          "ASSIGNMENT",
          "PILOT",
          "PRODUCT",
        ]),
        entityId: z.string().min(1).max(100),
        reason: z.string().trim().min(3).max(240),
        adminPin: z.string().min(4).max(32),
      })
      .strict(),
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

export const eventSnapshotSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventDate: z.string(),
  aerodrome: z.string(),
  timeZone: timeZoneSchema,
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
  maxTicketDeferrals: z.number().int().min(1).max(10),
  notificationLeadMinutes: z.number().int().positive(),
  automaticPrecallEnabled: z.boolean(),
  precallLeadMinutes: z.number().int().min(1).max(240),
  maximumGateWaitMinutes: z.number().int().min(1).max(120),
  precallMinimumQuality: z.enum(["STABLE", "CHANGING"]),
  precallGateCooldownMinutes: z.number().int().min(0).max(60),
  referenceWeightsKg: z.object({
    child: z.number().positive(),
    normal: z.number().positive(),
    heavy: z.number().positive(),
  }),
  plannedBoardingMinutes: z.number().int().positive(),
  plannedDeboardingMinutes: z.number().int().positive(),
  plannedBufferMinutes: z.number().int().nonnegative(),
  departedVisibilitySeconds: z.number().int().min(5).max(900).default(15),
  updatedAt: z.string(),
});

export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;

export const eventCatalogEntrySchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventDate: z.string(),
  aerodrome: z.string(),
  timeZone: timeZoneSchema,
  status: z.string(),
  archivedAt: z.string().nullable(),
  templateSourceId: z.string().nullable(),
  version: z.number().int().nonnegative(),
});
export const eventCatalogSchema = z.object({ events: z.array(eventCatalogEntrySchema) });
export type EventCatalogEntry = z.infer<typeof eventCatalogEntrySchema>;
export type EventCatalog = z.infer<typeof eventCatalogSchema>;

export const bootstrapRequestSchema = z.object({
  setupCode: z.string().min(8).max(256),
  adminPin: z.string().regex(/^\d{6,12}$/),
  eventId: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  name: z.string().trim().min(3).max(120),
  eventDate: z.iso.date(),
  aerodrome: z.string().trim().min(2).max(120),
  timeZone: timeZoneSchema.default("Europe/Berlin"),
  // Temporary development-harness compatibility. Production creates the technical origin inside
  // the Worker and never accepts it as browser-controlled authentication data.
  adminDeviceId: z.uuid().optional(),
  adminCredentialHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type BootstrapRequest = z.infer<typeof bootstrapRequestSchema>;

export const operatorRoleSchema = z.enum([
  "CASHIER",
  "FLIGHT_LINE",
  "FLIGHT_DIRECTOR",
  "ADMIN",
  "DISPLAY",
]);
export type OperatorRole = z.infer<typeof operatorRoleSchema>;

export const fidsLayoutSchema = z.enum(["SINGLE", "DOUBLE"]);
export type FidsLayout = z.infer<typeof fidsLayoutSchema>;

export const fidsThemeSchema = z.enum(["SYSTEM", "LIGHT", "DARK"]);
export type FidsTheme = z.infer<typeof fidsThemeSchema>;

export const fidsPreferencesSchema = z
  .object({
    visibleRows: z.number().int().min(4).max(20),
    layout: fidsLayoutSchema,
    theme: fidsThemeSchema,
    version: z.number().int().min(0),
  })
  .strict();
export type FidsPreferences = z.infer<typeof fidsPreferencesSchema>;

export const updateFidsPreferencesSchema = fidsPreferencesSchema
  .omit({ version: true })
  .extend({
    commandId: z.uuid(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type UpdateFidsPreferences = z.infer<typeof updateFidsPreferencesSchema>;

export const operatorAccountSummarySchema = z.object({
  id: z.uuid(),
  loginCode: z.string().regex(/^[A-Z]+-\d{2,}$/),
  role: operatorRoleSchema,
  active: z.boolean(),
});
export type OperatorAccountSummary = z.infer<typeof operatorAccountSummarySchema>;

export const operatorAccountCatalogSchema = z.object({
  accounts: z.array(operatorAccountSummarySchema.omit({ active: true })),
});
export type OperatorAccountCatalog = z.infer<typeof operatorAccountCatalogSchema>;

export const operatorLoginRequestSchema = z.object({
  accountId: z.uuid(),
  pin: z.string().regex(/^\d{6,12}$/),
  deviceId: z.uuid().optional(),
});
export type OperatorLoginRequest = z.infer<typeof operatorLoginRequestSchema>;

export const operatorSessionSchema = z.object({
  authenticated: z.literal(true),
  account: operatorAccountSummarySchema.omit({ active: true }),
});
export type OperatorSession = z.infer<typeof operatorSessionSchema>;

export const createOperatorAccountSchema = z.object({
  role: operatorRoleSchema,
  pin: z.string().regex(/^\d{6,12}$/),
});
export type CreateOperatorAccount = z.infer<typeof createOperatorAccountSchema>;

export const updateOperatorAccountSchema = z
  .object({
    active: z.boolean().optional(),
    revokeSessions: z.literal(true).optional(),
    pin: z
      .string()
      .regex(/^\d{6,12}$/)
      .optional(),
  })
  .refine(
    (value) =>
      value.active !== undefined || value.pin !== undefined || value.revokeSessions === true,
  );
export type UpdateOperatorAccount = z.infer<typeof updateOperatorAccountSchema>;

export const adminPinVerificationSchema = z.object({
  adminPin: z.string().min(4).max(32),
});
export type AdminPinVerification = z.infer<typeof adminPinVerificationSchema>;

export const adminDeviceRecoverySchema = z.object({
  adminPin: z.string().min(4).max(32),
  credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AdminDeviceRecovery = z.infer<typeof adminDeviceRecoverySchema>;

export const ticketGroupOperationalStatusSchema = z.enum([
  "QUEUED",
  "PRESENT",
  "CALLED",
  "BOARDING",
  "IN_FLIGHT",
  "LANDED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELED",
  "CLARIFICATION",
  "MISSING",
]);
export type TicketGroupOperationalStatus = z.infer<typeof ticketGroupOperationalStatusSchema>;

export const ticketSearchRequestSchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    status: z.enum(["ACTIVE", "OPEN", "CANCELED"]).default("ACTIVE"),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(500).optional(),
    ticketGroupIds: z.array(z.string().min(1).max(100)).max(50).default([]),
  })
  .refine((value) => value.ticketGroupIds.length === 0 || !value.cursor, {
    message: "ID-Revalidierung und Cursor können nicht kombiniert werden.",
  });
export type TicketSearchRequest = z.infer<typeof ticketSearchRequestSchema>;

export const ticketSearchResultSchema = z.object({
  ticketGroupId: z.string(),
  productId: z.string(),
  productCode: z.string(),
  productName: z.string(),
  groupStatus: ticketGroupOperationalStatusSchema,
  groupSize: z.number().int().positive(),
  queueSequence: z.number().int().positive(),
  bookingGroupNumber: z.number().int().positive(),
  bookingGroupLabel: z.string(),
  standby: z.boolean(),
  soldAt: z.string(),
  communicationNumber: z.number().int().positive().nullable(),
  communicationLabel: z.string().nullable(),
  communicationNumbers: z.array(z.number().int().positive()),
  communicationLabels: z.array(z.string()),
  rotationStatus: z.string().nullable(),
  rotationStatuses: z.array(z.string()),
});
export const ticketSearchResponseSchema = z.object({
  results: z.array(ticketSearchResultSchema).max(50),
  nextCursor: z.string().nullable(),
});
export type TicketSearchResult = z.infer<typeof ticketSearchResultSchema>;
export type TicketSearchResponse = z.infer<typeof ticketSearchResponseSchema>;

export const ticketGroupPrintDataSchema = z.object({
  ticketGroupId: z.string(),
  eventName: z.string(),
  productName: z.string(),
  gateLabel: z.string(),
  communicationLabel: z.string(),
  code: z.string().regex(/^[A-Z2-9]{12,32}$/),
  groupSize: z.number().int().positive(),
});
export type TicketGroupPrintData = z.infer<typeof ticketGroupPrintDataSchema>;

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
  timeZone: timeZoneSchema.default("Europe/Berlin"),
  restartMode: z.enum(["KEEP_MASTER_DATA", "EMPTY"]).default("KEEP_MASTER_DATA"),
});
export type CloneEventRequest = z.infer<typeof cloneEventRequestSchema>;

export const factoryResetRequestSchema = z
  .object({
    commandId: z.uuid(),
    eventId: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    reason: z.string().trim().min(3).max(240),
    adminPin: z.string().min(4).max(32),
    confirmation: z.literal("WERKSZUSTAND"),
    retainRecoveryBackup: z.boolean().default(true),
    deleteAllBackups: z.boolean().default(false),
  })
  .refine((input) => !(input.retainRecoveryBackup && input.deleteAllBackups), {
    message: "Eine zu behaltende Sicherung und das Löschen aller Sicherungen schließen sich aus.",
  });
export type FactoryResetRequest = z.infer<typeof factoryResetRequestSchema>;

export const factoryResetResponseSchema = z.object({
  resetComplete: z.literal(true),
  setupRequired: z.literal(true),
  recoveryBackupKey: z.string().nullable(),
  r2BackupsDeleted: z.boolean(),
});
export type FactoryResetResponse = z.infer<typeof factoryResetResponseSchema>;

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
  saleReceipt: ticketGroupPrintDataSchema.optional(),
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
  gateId: z.string().min(1),
  gateLabel: z.string().min(1),
  childCompanionRequired: z.boolean(),
  weightClasses: z.array(z.enum(["NOT_CAPTURED", "CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"])),
  sortOrder: z.number().int().nonnegative(),
  saleEnabled: z.boolean(),
  referenceCapacity: z.number().int().positive(),
  referenceDurationMinutes: z.number().int().positive(),
  promisedFlightMinutes: z.number().int().positive(),
  queuedTickets: z.number().int().nonnegative(),
  resourceGroupOpenTickets: z.number().int().nonnegative(),
  estimatedWaitLowerMinutes: z.number().int().nonnegative(),
  estimatedWaitUpperMinutes: z.number().int().nonnegative(),
  nextBoardingWindowLowerAt: z.iso.datetime().nullable(),
  nextBoardingWindowUpperAt: z.iso.datetime().nullable(),
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
  version: z.number().int().nonnegative(),
  flightGroupId: z.string(),
  communicationNumber: z.number().int().positive(),
  communicationLabel: z.string().regex(/^[A-Z0-9-]+-\d{3,}$/),
  queuePosition: z.number().int().positive(),
  productCode: z.string(),
  productName: z.string(),
  status: z.enum(["DRAFT", "CALLED", "IN_FLIGHT", "LANDED", "COMPLETED"]),
  bookingGroups: z
    .array(
      z.object({
        id: z.string(),
        communicationNumber: z.number().int().positive(),
        soldAt: z.string(),
        ticketCount: z.number().int().positive(),
        presentCount: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  ticketGroupId: z.string(),
  gateId: z.string().min(1),
  gateLabel: z.string().min(1),
  aircraftId: z.string().nullable(),
  aircraftRegistration: z.string().nullable(),
  pilotId: z.string().nullable(),
  pilotOperationalCode: z.string().nullable(),
  suggestedPilotId: z.string().nullable(),
  suggestedPilotOperationalCode: z.string().nullable(),
  suggestedAircraftId: z.string().nullable(),
  suggestedAircraftRegistration: z.string().nullable(),
  ticketCount: z.number().int().nonnegative(),
  baselineCapacity: z.number().int().positive(),
  usableCapacity: z.number().int().positive(),
  capacityReduced: z.boolean(),
  estimatedPassengerPayloadKg: z.number().positive().nullable(),
  predictedLowerMinutes: z.number().int().nonnegative(),
  predictedUpperMinutes: z.number().int().nonnegative(),
  boardingWindowLowerAt: z.iso.datetime().nullable(),
  boardingWindowUpperAt: z.iso.datetime().nullable(),
  precalledAt: z.string().nullable().optional(),
  calledAt: z.string().nullable(),
  deferralCount: z.number().int().nonnegative(),
  operationalNote: z.string(),
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
      status: z.enum([
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
      ]),
      attendanceStatus: z.enum(["NOT_CHECKED_IN", "CHECKED_IN"]),
    }),
  ),
});

export const aircraftOperationalSummarySchema = z.object({
  id: z.string(),
  version: z.number().int().nonnegative(),
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
  operationalStateChangedAt: z.string(),
  resourceGroupId: z.string(),
  resourceGroupName: z.string(),
  resourceGroupShortCode: z.string(),
  refuelPlanned: z.boolean(),
  rotationsSinceRefuel: z.number().int().nonnegative(),
  refuelReminderThreshold: z.number().int().positive(),
  expectedReviewAt: z.string().nullable(),
  currentPilotId: z.string().nullable(),
  currentPilotOperationalCode: z.string().nullable(),
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
  currentDeviceRole: z.enum(["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]),
  event: eventSnapshotSchema,
  products: z.array(productOperationalSummarySchema),
  rotations: z.array(rotationOperationalSummarySchema),
  queueGroups: z
    .array(
      z.object({
        id: z.string(),
        communicationNumber: z.number().int().positive(),
        productId: z.string(),
        productCode: z.string(),
        productName: z.string(),
        resourceGroupId: z.string(),
        gateId: z.string(),
        queueSequence: z.number().int().positive(),
        status: z.string(),
        ticketCount: z.number().int().positive(),
        presentCount: z.number().int().nonnegative(),
        nextSegmentTicketCount: z.number().int().positive().optional(),
        nextSegmentPresentCount: z.number().int().nonnegative().optional(),
        segmentIndex: z.number().int().positive().optional(),
        segmentCount: z.number().int().positive().optional(),
        recalledAt: z.string().nullable(),
        recallCount: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  aircraft: z.array(aircraftOperationalSummarySchema),
  assistClaims: z.array(
    z.object({
      aircraftId: z.string(),
      claimedByCurrentOperator: z.boolean(),
      ownerLoginCode: z.string(),
      revision: z.number().int().positive(),
      claimedAt: z.string(),
      expiresAt: z.string(),
    }),
  ),
  pilots: z.array(pilotOperationalSummarySchema),
  gates: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      gateType: z.enum(["FLIGHT_LINE", "BOARDING", "DISPLAY_ONLY"]),
      active: z.boolean(),
      sortOrder: z.number().int().nonnegative(),
      displayFilter: gateDisplayFilterSchema,
      assignedResourceGroupIds: z.array(z.string()),
    }),
  ),
  resourceGroups: z.array(
    z.object({
      id: z.string(),
      version: z.number().int().nonnegative(),
      name: z.string(),
      shortCode: z.string(),
      status: z.enum(["ACTIVE", "PAUSED", "INTERRUPTED", "ENDED"]),
      gateId: z.string(),
      gateLabel: z.string(),
      referenceCapacity: z.number().int().positive(),
      plannedRotationMinutes: z.number().int().positive(),
      compatibleAircraftTypes: z.array(z.string()),
      automaticPrecallEnabled: z.boolean(),
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

export const assistClaimMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACQUIRE_OR_RENEW") }).strict(),
  z
    .object({
      action: z.literal("TAKEOVER"),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
]);
export type AssistClaimMutation = z.infer<typeof assistClaimMutationSchema>;

export const assistClaimSchema = z.object({
  aircraftId: z.string(),
  claimedByCurrentOperator: z.boolean(),
  ownerLoginCode: z.string(),
  revision: z.number().int().positive(),
  claimedAt: z.string(),
  expiresAt: z.string(),
});
export type AssistClaim = z.infer<typeof assistClaimSchema>;

export const publicTicketStatusSchema = z
  .object({
    eventId: z.string(),
    eventName: z.string(),
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
    boardingWindowLowerAt: z.iso.datetime().nullable(),
    boardingWindowUpperAt: z.iso.datetime().nullable(),
    timeZone: timeZoneSchema,
    predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
    message: z.string(),
    operationalNotice: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type PublicTicketStatus = z.infer<typeof publicTicketStatusSchema>;

export const publicBoardSchema = z.object({
  eventName: z.string(),
  timeZone: timeZoneSchema,
  selectedGate: z
    .object({ id: z.string(), label: z.string(), displayFilter: gateDisplayFilterSchema })
    .nullable(),
  emergencyMode: z.boolean(),
  operationalInterrupted: z.boolean(),
  operationalNotice: z.string(),
  departedVisibilitySeconds: z.number().int().min(5).max(900).default(15),
  updatedAt: z.string(),
  groups: z.array(
    z
      .object({
        productName: z.string(),
        productCode: z.string(),
        gateLabel: z.string(),
        communicationNumber: z.number().int().positive(),
        ticketLabels: z.array(z.string()).min(1),
        aircraftRegistration: z.string().nullable(),
        departedAt: z.string().nullable().optional().default(null),
        status: z.enum([
          "WAITING",
          "COME_TO_FLIGHT_LINE",
          "BOARDING",
          "IN_FLIGHT",
          "LANDED",
          "COMPLETED",
          "SERVICE_PAUSED",
        ]),
        waitLowerMinutes: z.number().int().nonnegative(),
        waitUpperMinutes: z.number().int().nonnegative(),
        boardingWindowLowerAt: z.iso.datetime().nullable(),
        boardingWindowUpperAt: z.iso.datetime().nullable(),
        predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
        operationalNotice: z.string(),
      })
      .strict(),
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

const publicGroupPartSchema = z
  .object({
    partNumber: z.number().int().positive(),
    partCount: z.number().int().positive(),
    passengerCount: z.number().int().positive(),
    gateLabel: z.string(),
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
    boardingWindowLowerAt: z.iso.datetime().nullable(),
    boardingWindowUpperAt: z.iso.datetime().nullable(),
    predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
    message: z.string(),
  })
  .strict();

export const publicGroupStatusSchema = z
  .object({
    eventId: z.string(),
    eventName: z.string(),
    bookingGroupLabel: z.string(),
    groupSize: z.number().int().positive(),
    productName: z.string(),
    productCode: z.string(),
    publicDescription: z.string(),
    timeZone: timeZoneSchema,
    operationalNotice: z.string(),
    updatedAt: z.string(),
    parts: z.array(publicGroupPartSchema).min(1),
  })
  .strict();
export type PublicGroupStatus = z.infer<typeof publicGroupStatusSchema>;

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
  referenceDurationMinutes: z.number().int().nonnegative(),
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
