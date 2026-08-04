import { z } from "zod";

export {
  type FactoryResetRequest,
  type FactoryResetResponse,
  factoryResetRequestSchema,
  factoryResetResponseSchema,
} from "./factory-reset";

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

export const operationalPlanScopeSchema = z.enum(["EVENT", "RESOURCE_GROUP", "AIRCRAFT", "PILOT"]);
export type OperationalPlanScope = z.infer<typeof operationalPlanScopeSchema>;
export const operationalPlanKindSchema = z.enum([
  "PAUSE",
  "REFUELING",
  "FLIGHT_SHOW",
  "WEATHER",
  "TECHNICAL",
  "OTHER",
]);
export type OperationalPlanKind = z.infer<typeof operationalPlanKindSchema>;
export const operationalPlanStartModeSchema = z.enum(["TIME_WINDOW", "AFTER_CURRENT_ROTATION"]);
export type OperationalPlanStartMode = z.infer<typeof operationalPlanStartModeSchema>;
export const operationalPlanEffectModeSchema = z.enum(["BLOCKING", "SLOWDOWN"]);
export type OperationalPlanEffectMode = z.infer<typeof operationalPlanEffectModeSchema>;
export const operationalPlanStatusSchema = z.enum([
  "PLANNED",
  "DUE",
  "ACTIVE",
  "CLEARED",
  "CANCELED",
]);

export const recurringOperationalRuleScopeSchema = z.enum(["AIRCRAFT", "PILOT"]);
export type RecurringOperationalRuleScope = z.infer<typeof recurringOperationalRuleScopeSchema>;
export const recurringOperationalRuleKindSchema = z.enum(["PAUSE", "REFUELING"]);
export type RecurringOperationalRuleKind = z.infer<typeof recurringOperationalRuleKindSchema>;
export const recurringOperationalRuleTriggerSchema = z.enum([
  "COMPLETED_ROTATIONS",
  "OPERATING_MINUTES",
]);
export type RecurringOperationalRuleTrigger = z.infer<typeof recurringOperationalRuleTriggerSchema>;
export const recurringOperationalRuleStatusSchema = z.enum(["ACTIVE", "DISABLED"]);

const recurringOperationalRuleValuesSchema = z
  .object({
    scopeType: recurringOperationalRuleScopeSchema,
    scopeId: z.string().min(1).max(100),
    kind: recurringOperationalRuleKindSchema,
    triggerMetric: recurringOperationalRuleTriggerSchema,
    intervalValue: z.number().int().min(1).max(100_000),
    minimumDurationMinutes: z.number().int().min(1).max(1440),
    typicalDurationMinutes: z.number().int().min(1).max(1440),
    maximumDurationMinutes: z.number().int().min(1).max(1440),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.kind === "REFUELING" && rule.scopeType !== "AIRCRAFT") {
      context.addIssue({
        code: "custom",
        message: "Tanken kann nur für ein Flugzeug geplant werden.",
        path: ["scopeType"],
      });
    }
    if (
      rule.minimumDurationMinutes > rule.typicalDurationMinutes ||
      rule.typicalDurationMinutes > rule.maximumDurationMinutes
    ) {
      context.addIssue({
        code: "custom",
        message: "Die Dauer muss als Minimum ≤ Typisch ≤ Maximum angegeben werden.",
        path: ["typicalDurationMinutes"],
      });
    }
  });

const upsertPlannedOperationPayloadSchema = z
  .object({
    planId: z.uuid(),
    planExpectedVersion: z.number().int().nonnegative().nullable(),
    scopeType: operationalPlanScopeSchema,
    scopeId: z.string().min(1).max(100),
    kind: operationalPlanKindSchema,
    effectMode: operationalPlanEffectModeSchema.default("BLOCKING"),
    durationMultiplierPercent: z.number().int().min(110).max(300).nullable().default(null),
    startMode: operationalPlanStartModeSchema,
    earliestStartAt: z.iso.datetime().nullable(),
    latestStartAt: z.iso.datetime().nullable(),
    afterRotationId: z.string().min(1).max(100).nullable(),
    minimumDurationMinutes: z.number().int().min(1).max(1440),
    typicalDurationMinutes: z.number().int().min(1).max(1440),
    maximumDurationMinutes: z.number().int().min(1).max(1440),
    publicNote: z.string().trim().max(160),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      (payload.effectMode === "BLOCKING" && payload.durationMultiplierPercent !== null) ||
      (payload.effectMode === "SLOWDOWN" && payload.durationMultiplierPercent === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Verzögerungsart und Faktor passen nicht zusammen.",
        path: ["durationMultiplierPercent"],
      });
    }
    if (
      payload.minimumDurationMinutes > payload.typicalDurationMinutes ||
      payload.typicalDurationMinutes > payload.maximumDurationMinutes
    ) {
      context.addIssue({
        code: "custom",
        message: "Die Dauer muss als Minimum ≤ Typisch ≤ Maximum angegeben werden.",
        path: ["typicalDurationMinutes"],
      });
    }
    if (payload.publicNote.length > 0 && !["EVENT", "RESOURCE_GROUP"].includes(payload.scopeType)) {
      context.addIssue({
        code: "custom",
        message: "Öffentliche Hinweise sind nur veranstaltungs- oder gruppenweit zulässig.",
        path: ["publicNote"],
      });
    }
    if (payload.startMode === "TIME_WINDOW") {
      if (
        !payload.earliestStartAt ||
        !payload.latestStartAt ||
        Date.parse(payload.earliestStartAt) > Date.parse(payload.latestStartAt)
      ) {
        context.addIssue({
          code: "custom",
          message: "Das Startzeitfenster ist unvollständig oder ungültig.",
          path: ["earliestStartAt"],
        });
      }
      if (payload.afterRotationId !== null) {
        context.addIssue({
          code: "custom",
          message: "Ein Zeitfenster darf nicht zugleich an einen Umlauf gebunden sein.",
          path: ["afterRotationId"],
        });
      }
    } else if (
      payload.afterRotationId === null ||
      payload.earliestStartAt !== null ||
      payload.latestStartAt !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Ein umlaufgebundener Beginn benötigt genau einen Umlauf.",
        path: ["afterRotationId"],
      });
    }
  });

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
const turnaroundPhaseOverrideValueSchema = z.number().int().min(0).max(120).nullable();

const cashierProductOrderSchema = z
  .array(z.string().min(1).max(100))
  .min(1)
  .max(1000)
  .refine((values) => new Set(values).size === values.length, {
    message: "Die Kassenreihenfolge darf keine Produkte doppelt enthalten.",
  });

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
    // Operative Produkt-Planzeit vom bestätigten Offblock bis zum bestätigten Onblock.
    referenceDurationMinutes: z.number().int().min(1).max(600),
    // Gegenüber Gästen kommunizierte Produktzeit ohne Wirkung auf die operative Prognose.
    promisedFlightMinutes: z.number().int().min(1).max(600),
    plannedBoardingMinutesOverride: turnaroundPhaseOverrideValueSchema.default(null),
    plannedDeboardingMinutesOverride: turnaroundPhaseOverrideValueSchema.default(null),
    plannedBufferMinutesOverride: turnaroundPhaseOverrideValueSchema.default(null),
    childCompanionRequired: z.boolean(),
    weightClasses: z
      .array(productWeightClassSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length, {
        message: "Gewichtsklassen dürfen nicht doppelt vorkommen.",
      }),
    // Rückwärtskompatibel für ältere Clients; die Kassenreihenfolge wird separat gepflegt.
    sortOrder: z.number().int().min(0).max(1000).optional(),
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
      dispatchRecommendation: z
        .object({
          planRevision: z.string().min(1).max(100),
          batchId: z.string().min(1).max(100),
        })
        .strict()
        .optional(),
      dispatchRecommendationLeaseId: z.uuid().optional(),
      queueDeviationReason: z.string().trim().min(3).max(240).optional(),
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
        plannedOperationId: z.uuid().optional(),
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
        plannedOperationId: z.uuid().optional(),
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
    type: z.literal("UPSERT_PLANNED_OPERATION"),
    payload: upsertPlannedOperationPayloadSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("CANCEL_PLANNED_OPERATION"),
    payload: z
      .object({
        planId: z.uuid(),
        planExpectedVersion: z.number().int().nonnegative(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_PLANNED_SLOWDOWN_ACTIVE"),
    payload: z
      .object({
        planId: z.uuid(),
        planExpectedVersion: z.number().int().nonnegative(),
        active: z.boolean(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_RECURRING_OPERATIONAL_RULE"),
    payload: z
      .object({
        ruleId: z.uuid(),
        ruleExpectedVersion: z.number().int().nonnegative().nullable(),
        rule: recurringOperationalRuleValuesSchema,
        reason: z.string().trim().min(3).max(240),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("DISABLE_RECURRING_OPERATIONAL_RULE"),
    payload: z
      .object({
        ruleId: z.uuid(),
        ruleExpectedVersion: z.number().int().nonnegative(),
        reason: z.string().trim().min(3).max(240),
      })
      .strict(),
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
        plannedOperationId: z.uuid().optional(),
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
        plannedOperationId: z.uuid().optional(),
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
    type: z.literal("START_TICKET_GROUP_RECALL"),
    payload: z.object({ ticketGroupId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CLEAR_TICKET_GROUP_RECALL"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      recallId: z.uuid(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("RESTORE_TICKET_GROUP_TO_QUEUE"),
    payload: z.object({ ticketGroupId: z.string().min(1).max(100) }),
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
      operationsStartAt: z.iso.datetime().nullable().default(null),
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
      travelLeadMinutes: z.number().int().min(0).max(30).default(0),
      displayFilter: gateDisplayFilterSchema.optional(),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("REORDER_CASHIER_PRODUCTS"),
    payload: z
      .object({
        expectedProductIds: cashierProductOrderSchema,
        orderedProductIds: cashierProductOrderSchema,
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_PRODUCT"),
    payload: upsertProductPayloadSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"),
    payload: z
      .object({
        aircraftId: z.string().min(1).max(100),
        productId: z.string().min(1).max(100),
        plannedBoardingMinutesOverride: turnaroundPhaseOverrideValueSchema,
        plannedDeboardingMinutesOverride: turnaroundPhaseOverrideValueSchema,
        plannedBufferMinutesOverride: turnaroundPhaseOverrideValueSchema,
        expectedOverrideVersion: z.number().int().nonnegative().optional(),
        reason: z.string().trim().min(3).max(240),
        adminPin: z.string().min(4).max(32),
      })
      .refine(
        (payload) =>
          payload.plannedBoardingMinutesOverride !== null ||
          payload.plannedDeboardingMinutesOverride !== null ||
          payload.plannedBufferMinutesOverride !== null,
        { message: "Mindestens eine Phase muss überschrieben werden." },
      ),
  }),
  commandBaseSchema.extend({
    type: z.literal("DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      productId: z.string().min(1).max(100),
      expectedOverrideVersion: z.number().int().nonnegative(),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
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
  operationsStartAt: z.string().nullable().default(null),
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
  logoVariants: z
    .object({
      light: z.boolean(),
      dark: z.boolean(),
    })
    .optional(),
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
  setupCode: z.string().min(8).max(256).optional(),
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

export const fidsViewModeSchema = z.enum(["FIXED_PAGE", "SPLIT"]);
export type FidsViewMode = z.infer<typeof fidsViewModeSchema>;

const uniqueFidsIdsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "FIDS filter IDs must be unique");

export const fidsContentFilterSchema = z
  .object({
    productIds: uniqueFidsIdsSchema.default([]),
    gateIds: uniqueFidsIdsSchema.default([]),
  })
  .strict();
export type FidsContentFilter = z.infer<typeof fidsContentFilterSchema>;

export const eventLogoThemeSchema = z.enum(["light", "dark"]);
export type EventLogoTheme = z.infer<typeof eventLogoThemeSchema>;

const fidsPreferencesFieldsSchema = z
  .object({
    visibleRows: z.number().int().min(4).max(20),
    layout: fidsLayoutSchema,
    theme: fidsThemeSchema,
    viewMode: fidsViewModeSchema.default("FIXED_PAGE"),
    priorityGroupCount: z.number().int().min(1).max(19).default(3),
    rotationIntervalSeconds: z.number().int().min(5).max(60).default(12),
    groupSharedFlights: z.boolean().default(false),
    contentFilter: fidsContentFilterSchema.default({ productIds: [], gateIds: [] }),
    version: z.number().int().min(0),
  })
  .strict();

export const fidsPreferencesSchema = fidsPreferencesFieldsSchema.refine(
  (preferences) => preferences.priorityGroupCount < preferences.visibleRows,
  {
    message: "Priority group count must be lower than visible rows",
    path: ["priorityGroupCount"],
  },
);
export type FidsPreferences = z.infer<typeof fidsPreferencesSchema>;

export const updateFidsPreferencesSchema = fidsPreferencesFieldsSchema
  .omit({ version: true })
  .extend({
    commandId: z.uuid(),
    expectedVersion: z.number().int().min(0),
  })
  .refine((preferences) => preferences.priorityGroupCount < preferences.visibleRows, {
    message: "Priority group count must be lower than visible rows",
    path: ["priorityGroupCount"],
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

export const ticketGroupRecallEndReasonSchema = z.enum([
  "MANUAL",
  "PRESENT",
  "BOARDING",
  "DEFERRED",
  "NO_SHOW",
  "CANCELED",
  "EXPIRED",
]);
export type TicketGroupRecallEndReason = z.infer<typeof ticketGroupRecallEndReasonSchema>;

export const ticketGroupRecallProjectionSchema = z
  .object({
    id: z.uuid(),
    sequence: z.number().int().positive(),
    startedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    fidsMessage: z.string().min(1),
    publicMessage: z.string().min(1),
  })
  .strict();
export type TicketGroupRecallProjection = z.infer<typeof ticketGroupRecallProjectionSchema>;

export const ticketSearchRequestSchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    status: z.enum(["ACTIVE", "OPEN", "CANCELED"]).default("ACTIVE"),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(500).optional(),
    ticketGroupIds: z.array(z.string().min(1).max(100)).max(50).default([]),
    soldByOperatorAccountId: z.uuid().optional(),
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
  soldByOperatorAccountId: z.string().nullable(),
  soldByOperatorLoginCode: z.string().nullable(),
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

const masterDataTemplateKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,99}$/);

const masterDataTemplateSourceSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    version: z.number().int().nonnegative(),
  })
  .strict();

const masterDataTemplateEventParametersSchema = z
  .object({
    noShowAfterMinutes: z.number().int().min(1).max(120),
    maxTicketDeferrals: z.number().int().min(1).max(10),
    notificationLeadMinutes: z.number().int().min(1).max(240),
    automaticPrecallEnabled: z.boolean(),
    precallLeadMinutes: z.number().int().min(1).max(240),
    maximumGateWaitMinutes: z.number().int().min(1).max(120),
    precallMinimumQuality: z.enum(["STABLE", "CHANGING"]),
    precallGateCooldownMinutes: z.number().int().min(0).max(60),
    referenceWeightsKg: z
      .object({
        child: z.number().positive().max(300),
        normal: z.number().positive().max(300),
        heavy: z.number().positive().max(300),
      })
      .strict(),
    plannedBoardingMinutes: z.number().int().min(1).max(120),
    plannedDeboardingMinutes: z.number().int().min(1).max(120),
    plannedBufferMinutes: z.number().int().min(0).max(120),
    departedVisibilitySeconds: z.number().int().min(5).max(900),
  })
  .strict();

const masterDataTemplateGateSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    label: z.string().trim().min(2).max(80),
    gateType: z.enum(["FLIGHT_LINE", "BOARDING", "DISPLAY_ONLY"]),
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000),
    travelLeadMinutes: z.number().int().min(0).max(30).default(0),
    displayFilter: z
      .object({
        productKeys: z.array(masterDataTemplateKeySchema).max(100),
        rotationStatuses: gateDisplayFilterSchema.shape.rotationStatuses,
      })
      .strict(),
  })
  .strict();

const masterDataTemplateResourceGroupSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    name: z.string().trim().min(2).max(100),
    shortCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{2,8}$/),
    gateKey: masterDataTemplateKeySchema,
    referenceCapacity: z.number().int().min(1).max(100),
    compatibleAircraftTypes: z.array(z.string().trim().min(1).max(80)).max(50),
    automaticPrecallEnabled: z.boolean(),
  })
  .strict();

const masterDataTemplateAircraftSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    registration: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{3,16}$/),
    aircraftType: z.string().trim().min(2).max(80),
    passengerSeats: z.number().int().min(1).max(100),
    maximumPassengerPayloadKg: z.number().positive().max(10_000).nullable(),
    refuelReminderThreshold: z.number().int().min(1).max(100),
  })
  .strict();

const masterDataTemplateAssignmentSchema = z
  .object({
    aircraftKey: masterDataTemplateKeySchema,
    resourceGroupKey: masterDataTemplateKeySchema,
  })
  .strict();

const masterDataTemplatePilotSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    operationalCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{2,12}$/),
    operationalNote: z.string().trim().max(240),
    active: z.boolean(),
  })
  .strict();

const masterDataTemplateTurnaroundOverrideSchema = z
  .object({
    aircraftKey: masterDataTemplateKeySchema,
    productKey: masterDataTemplateKeySchema,
    plannedBoardingMinutesOverride: turnaroundPhaseOverrideValueSchema,
    plannedDeboardingMinutesOverride: turnaroundPhaseOverrideValueSchema,
    plannedBufferMinutesOverride: turnaroundPhaseOverrideValueSchema,
  })
  .strict();

const masterDataTemplateProductSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    resourceGroupKey: masterDataTemplateKeySchema,
    gateKey: masterDataTemplateKeySchema,
    name: z.string().trim().min(2).max(100),
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{2,12}$/),
    publicDescription: z.string().trim().max(240),
    priceCents: z.number().int().min(0).max(1_000_000),
    referenceCapacity: z.number().int().min(1).max(100),
    // Operative Produkt-Planzeit vom bestätigten Offblock bis zum bestätigten Onblock.
    referenceDurationMinutes: z.number().int().min(1).max(600),
    // Gegenüber Gästen kommunizierte Produktzeit ohne Wirkung auf die operative Prognose.
    promisedFlightMinutes: z.number().int().min(1).max(600),
    plannedBoardingMinutesOverride: turnaroundPhaseOverrideValueSchema.default(null),
    plannedDeboardingMinutesOverride: turnaroundPhaseOverrideValueSchema.default(null),
    plannedBufferMinutesOverride: turnaroundPhaseOverrideValueSchema.default(null),
    childCompanionRequired: z.boolean(),
    weightClasses: z.array(productWeightClassSchema).min(1).max(5),
    sortOrder: z.number().int().min(0).max(1000),
    capacityWarningThreshold: z.number().int().min(0).max(10_000),
    capacityCriticalThreshold: z.number().int().min(0).max(10_000),
  })
  .strict();

function addDuplicateIssues(
  context: z.core.$RefinementCtx<unknown>,
  values: readonly string[],
  path: string,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `${label} ist doppelt vorhanden.`,
        path: [path, index],
      });
    }
    seen.add(value);
  });
}

const canonicalMasterDataTemplateSchema = z
  .object({
    format: z.literal("rundflug-master-data-template"),
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    exportedAt: z.iso.datetime(),
    source: masterDataTemplateSourceSchema,
    eventParameters: masterDataTemplateEventParametersSchema,
    gates: z.array(masterDataTemplateGateSchema).max(100),
    resourceGroups: z.array(masterDataTemplateResourceGroupSchema).max(100),
    aircraft: z.array(masterDataTemplateAircraftSchema).max(200),
    assignments: z.array(masterDataTemplateAssignmentSchema).max(200),
    pilots: z.array(masterDataTemplatePilotSchema).max(200),
    products: z.array(masterDataTemplateProductSchema).max(200),
    aircraftProductTurnaroundOverrides: z
      .array(masterDataTemplateTurnaroundOverrideSchema)
      .max(20_000)
      .default([]),
  })
  .strict()
  .superRefine((template, context) => {
    addDuplicateIssues(
      context,
      template.gates.map((entry) => entry.key),
      "gates",
      "Gate-Schlüssel",
    );
    addDuplicateIssues(
      context,
      template.gates.map((entry) => entry.label.toLocaleLowerCase("de-DE")),
      "gates",
      "Gate-Bezeichnung",
    );
    addDuplicateIssues(
      context,
      template.resourceGroups.map((entry) => entry.key),
      "resourceGroups",
      "Ressourcengruppen-Schlüssel",
    );
    addDuplicateIssues(
      context,
      template.resourceGroups.map((entry) => entry.name.toLocaleLowerCase("de-DE")),
      "resourceGroups",
      "Ressourcengruppenname",
    );
    addDuplicateIssues(
      context,
      template.resourceGroups.map((entry) => entry.shortCode),
      "resourceGroups",
      "Ressourcengruppen-Kürzel",
    );
    addDuplicateIssues(
      context,
      template.aircraft.map((entry) => entry.key),
      "aircraft",
      "Flugzeug-Schlüssel",
    );
    addDuplicateIssues(
      context,
      template.aircraft.map((entry) => entry.registration),
      "aircraft",
      "Flugzeugkennung",
    );
    addDuplicateIssues(
      context,
      template.assignments.map((entry) => entry.aircraftKey),
      "assignments",
      "Flugzeugzuordnung",
    );
    addDuplicateIssues(
      context,
      template.pilots.map((entry) => entry.key),
      "pilots",
      "Pilotenschlüssel",
    );
    addDuplicateIssues(
      context,
      template.pilots.map((entry) => entry.operationalCode),
      "pilots",
      "Pilotencode",
    );
    addDuplicateIssues(
      context,
      template.products.map((entry) => entry.key),
      "products",
      "Produkt-Schlüssel",
    );
    addDuplicateIssues(
      context,
      template.products.map((entry) => entry.code),
      "products",
      "Produktcode",
    );
    addDuplicateIssues(
      context,
      template.aircraftProductTurnaroundOverrides.map(
        (entry) => `${entry.aircraftKey}:${entry.productKey}`,
      ),
      "aircraftProductTurnaroundOverrides",
      "Flugzeug-/Produkt-Ausnahme",
    );

    const gateKeys = new Set(template.gates.map((entry) => entry.key));
    const resourceGroupKeys = new Set(template.resourceGroups.map((entry) => entry.key));
    const aircraftKeys = new Set(template.aircraft.map((entry) => entry.key));
    const productKeys = new Set(template.products.map((entry) => entry.key));
    template.resourceGroups.forEach((entry, index) => {
      if (!gateKeys.has(entry.gateKey)) {
        context.addIssue({
          code: "custom",
          message: "Gate-Verweis ist nicht im Template enthalten.",
          path: ["resourceGroups", index, "gateKey"],
        });
      }
    });
    template.products.forEach((entry, index) => {
      if (!gateKeys.has(entry.gateKey)) {
        context.addIssue({
          code: "custom",
          message: "Gate-Verweis ist nicht im Template enthalten.",
          path: ["products", index, "gateKey"],
        });
      }
      if (!resourceGroupKeys.has(entry.resourceGroupKey)) {
        context.addIssue({
          code: "custom",
          message: "Ressourcengruppen-Verweis ist nicht im Template enthalten.",
          path: ["products", index, "resourceGroupKey"],
        });
      }
    });
    template.gates.forEach((entry, index) => {
      entry.displayFilter.productKeys.forEach((productKey, productIndex) => {
        if (!productKeys.has(productKey)) {
          context.addIssue({
            code: "custom",
            message: "Produktfilter verweist auf kein Template-Produkt.",
            path: ["gates", index, "displayFilter", "productKeys", productIndex],
          });
        }
      });
    });
    template.assignments.forEach((entry, index) => {
      if (!aircraftKeys.has(entry.aircraftKey)) {
        context.addIssue({
          code: "custom",
          message: "Flugzeug-Verweis ist nicht im Template enthalten.",
          path: ["assignments", index, "aircraftKey"],
        });
      }
      if (!resourceGroupKeys.has(entry.resourceGroupKey)) {
        context.addIssue({
          code: "custom",
          message: "Ressourcengruppen-Verweis ist nicht im Template enthalten.",
          path: ["assignments", index, "resourceGroupKey"],
        });
      }
    });
    template.aircraftProductTurnaroundOverrides.forEach((entry, index) => {
      if (!aircraftKeys.has(entry.aircraftKey)) {
        context.addIssue({
          code: "custom",
          message: "Umlaufzeit-Ausnahme verweist auf kein Template-Flugzeug.",
          path: ["aircraftProductTurnaroundOverrides", index, "aircraftKey"],
        });
      }
      if (!productKeys.has(entry.productKey)) {
        context.addIssue({
          code: "custom",
          message: "Umlaufzeit-Ausnahme verweist auf kein Template-Produkt.",
          path: ["aircraftProductTurnaroundOverrides", index, "productKey"],
        });
      }
    });
  });

function removeLegacyResourceGroupRotationMinutes(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const template = value as Record<string, unknown>;
  if (!Array.isArray(template.resourceGroups)) return value;
  return {
    ...template,
    resourceGroups: template.resourceGroups.map((resourceGroup) => {
      if (!resourceGroup || typeof resourceGroup !== "object" || Array.isArray(resourceGroup)) {
        return resourceGroup;
      }
      const normalized = { ...(resourceGroup as Record<string, unknown>) };
      delete normalized.plannedRotationMinutes;
      return normalized;
    }),
  };
}

export const masterDataTemplateSchema = z.preprocess(
  removeLegacyResourceGroupRotationMinutes,
  canonicalMasterDataTemplateSchema,
);
export type MasterDataTemplate = z.infer<typeof masterDataTemplateSchema>;

const simulationPlanScheduleSchema = z
  .object({
    timeZone: timeZoneSchema,
    salesStartAt: z.iso.datetime(),
    salesEndAt: z.iso.datetime(),
    operationsStartAt: z.iso.datetime(),
    operationsEndAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((schedule, context) => {
    if (Date.parse(schedule.salesStartAt) >= Date.parse(schedule.salesEndAt)) {
      context.addIssue({
        code: "custom",
        message: "Das Verkaufsende muss nach dem Verkaufsbeginn liegen.",
        path: ["salesEndAt"],
      });
    }
    if (Date.parse(schedule.operationsStartAt) >= Date.parse(schedule.operationsEndAt)) {
      context.addIssue({
        code: "custom",
        message: "Das Betriebsende muss nach dem Betriebsbeginn liegen.",
        path: ["operationsEndAt"],
      });
    }
    if (Date.parse(schedule.salesEndAt) > Date.parse(schedule.operationsEndAt)) {
      context.addIssue({
        code: "custom",
        message: "Der Verkauf darf nicht nach dem Flugbetrieb enden.",
        path: ["salesEndAt"],
      });
    }
  });
export type SimulationPlanSchedule = z.infer<typeof simulationPlanScheduleSchema>;

const simulationScenarioDistributionSchema = z
  .object({
    minimum: z.number().nonnegative(),
    typical: z.number().nonnegative(),
    maximum: z.number().nonnegative(),
  })
  .strict()
  .superRefine((distribution, context) => {
    if (
      distribution.minimum > distribution.typical ||
      distribution.typical > distribution.maximum
    ) {
      context.addIssue({
        code: "custom",
        message: "Die Verteilung muss Minimum ≤ typisch ≤ Maximum erfüllen.",
        path: ["typical"],
      });
    }
  });

const simulationScenarioIncidentSchema = z
  .object({
    enabled: z.boolean(),
    duration: simulationScenarioDistributionSchema,
  })
  .strict();

const simulationScenarioDemandSchema = z
  .object({
    profile: z.enum(["UNIFORM", "OPENING_RUSH", "TWO_WAVES", "LATE_RUSH", "CUSTOM"]),
    windows: z
      .array(
        z
          .object({
            startOffsetMinutes: z.number().int().nonnegative(),
            endOffsetMinutes: z.number().int().positive(),
            personsPerHour: z.number().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

const simulationScenarioForecastTuningSchema = z
  .object({
    maximumSamples: z.number().int().min(1).max(100),
    referenceWeight: z.number().positive(),
    firstSampleWeight: z.number().positive(),
    recencyWeightIncrement: z.number().nonnegative(),
    referenceOutlierMultiplier: z.number().min(1),
    madMultiplier: z.number().nonnegative(),
    minimumMadToleranceRatio: z.number().nonnegative(),
    stableMinimumSamples: z.number().int().min(1).max(100),
    stableMaximumMeanDeviationMinutes: z.number().nonnegative(),
    stableMarginMinutes: z.number().nonnegative(),
    changingMarginMinutes: z.number().nonnegative(),
  })
  .strict()
  .superRefine((tuning, context) => {
    if (tuning.stableMinimumSamples > tuning.maximumSamples) {
      context.addIssue({
        code: "custom",
        message: "Die stabile Mindeststichprobe darf die maximale Stichprobe nicht überschreiten.",
        path: ["stableMinimumSamples"],
      });
    }
  });

const simulationScenarioPrecallTuningSchema = z
  .object({
    desiredGateWaitMinutes: z.number().nonnegative(),
    baselineLeadMinutes: z.number().nonnegative(),
    minimumLeadMinutes: z.number().nonnegative(),
    maximumLeadMinutes: z.number().nonnegative(),
    correctionFactor: z.number().nonnegative(),
    observationSampleLimit: z.number().int().min(1).max(100),
    gateCooldownMinutes: z.number().min(0).max(60),
  })
  .strict()
  .superRefine((tuning, context) => {
    if (tuning.maximumLeadMinutes < tuning.minimumLeadMinutes) {
      context.addIssue({
        code: "custom",
        message: "Der maximale Vorlauf darf den minimalen Vorlauf nicht unterschreiten.",
        path: ["maximumLeadMinutes"],
      });
    }
  });

const simulationScenarioVersionOneConfigSchema = z
  .object({
    preset: z.enum(["NORMAL", "PEAK_LOAD", "AIRCRAFT_FAILURE", "OPERATION_INTERRUPTION"]),
    seed: z.number().int().min(1).max(4_294_967_295),
    schedule: simulationPlanScheduleSchema,
    adminParameters: z
      .object({
        plannedBoardingMinutes: z.number().int().min(1).max(600),
        productReferenceDurationMinutes: z.number().int().min(1).max(600),
        plannedDeboardingMinutes: z.number().int().min(1).max(600),
        plannedBufferMinutes: z.number().int().min(0).max(600),
        eventAutomaticPrecallEnabled: z.boolean(),
        resourceGroupAutomaticPrecallEnabled: z.boolean(),
        aircraftCount: z.number().int().min(1).max(12),
        aircraftType: z.string().trim().min(2).max(100),
        passengerSeats: z.number().int().min(1).max(100),
        activePilotCount: z.number().int().min(0).max(200),
      })
      .strict(),
    realityModel: z
      .object({
        demand: simulationScenarioDemandSchema,
        phases: z
          .object({
            boarding: simulationScenarioDistributionSchema,
            flight: simulationScenarioDistributionSchema,
            deboarding: simulationScenarioDistributionSchema,
            buffer: simulationScenarioDistributionSchema,
          })
          .strict(),
        incidents: z
          .object({
            refueling: simulationScenarioIncidentSchema
              .extend({ everyRotations: z.number().int().min(1).max(100_000) })
              .strict(),
            plannedPause: simulationScenarioIncidentSchema
              .extend({ everyOperatingMinutes: z.number().int().min(1).max(100_000) })
              .strict(),
            unplannedPause: simulationScenarioIncidentSchema
              .extend({ ratePerOperatingHour: z.number().nonnegative() })
              .strict(),
            technicalDefect: simulationScenarioIncidentSchema
              .extend({
                ratePerOperatingHour: z.number().nonnegative(),
                dayOutageProbability: z.number().min(0).max(1),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    forecastTuning: z
      .object({
        forecast: simulationScenarioForecastTuningSchema,
        precall: simulationScenarioPrecallTuningSchema,
        comparisonRuns: z.number().int().min(5).max(100),
        availabilityModel: z.enum(["SCALAR", "TIME_DEPENDENT"]),
      })
      .strict(),
  })
  .strict();

const simulationScenarioVersionOneTemplateSchema = z
  .object({
    format: z.literal("rundflug-simulation-scenario"),
    formatVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    name: z.string().trim().min(1).max(80),
    config: simulationScenarioVersionOneConfigSchema,
  })
  .strict();

const simulationPlanOperationSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    scopeType: operationalPlanScopeSchema,
    scopeKey: masterDataTemplateKeySchema,
    kind: operationalPlanKindSchema,
    effectMode: operationalPlanEffectModeSchema.default("BLOCKING"),
    durationMultiplierPercent: z.number().int().min(110).max(300).nullable().default(null),
    startMode: operationalPlanStartModeSchema,
    earliestStartAt: z.iso.datetime().nullable(),
    latestStartAt: z.iso.datetime().nullable(),
    afterCurrentRotation: z.boolean(),
    minimumDurationMinutes: z.number().int().min(1).max(1440),
    typicalDurationMinutes: z.number().int().min(1).max(1440),
    maximumDurationMinutes: z.number().int().min(1).max(1440),
    publicNote: z.string().trim().max(160),
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      (operation.effectMode === "BLOCKING" && operation.durationMultiplierPercent !== null) ||
      (operation.effectMode === "SLOWDOWN" && operation.durationMultiplierPercent === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Verzögerungsart und Faktor passen nicht zusammen.",
        path: ["durationMultiplierPercent"],
      });
    }
    if (
      operation.minimumDurationMinutes > operation.typicalDurationMinutes ||
      operation.typicalDurationMinutes > operation.maximumDurationMinutes
    ) {
      context.addIssue({
        code: "custom",
        message: "Die Dauer muss als Minimum ≤ Typisch ≤ Maximum angegeben werden.",
        path: ["typicalDurationMinutes"],
      });
    }
    if (operation.startMode === "TIME_WINDOW") {
      if (
        !operation.earliestStartAt ||
        !operation.latestStartAt ||
        Date.parse(operation.earliestStartAt) > Date.parse(operation.latestStartAt) ||
        operation.afterCurrentRotation
      ) {
        context.addIssue({
          code: "custom",
          message: "Das Startzeitfenster ist unvollständig oder ungültig.",
          path: ["earliestStartAt"],
        });
      }
    } else if (
      operation.earliestStartAt !== null ||
      operation.latestStartAt !== null ||
      !operation.afterCurrentRotation
    ) {
      context.addIssue({
        code: "custom",
        message: "Ein umlaufgebundener Beginn darf kein Startzeitfenster enthalten.",
        path: ["afterCurrentRotation"],
      });
    }
    if (
      operation.publicNote.length > 0 &&
      !["EVENT", "RESOURCE_GROUP"].includes(operation.scopeType)
    ) {
      context.addIssue({
        code: "custom",
        message: "Öffentliche Hinweise sind nur veranstaltungs- oder gruppenweit zulässig.",
        path: ["publicNote"],
      });
    }
  });
export type SimulationPlanOperation = z.infer<typeof simulationPlanOperationSchema>;

const simulationRecurringOperationalRuleSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    scopeType: recurringOperationalRuleScopeSchema,
    scopeKey: masterDataTemplateKeySchema,
    kind: recurringOperationalRuleKindSchema,
    triggerMetric: recurringOperationalRuleTriggerSchema,
    intervalValue: z.number().int().min(1).max(100_000),
    progressValue: z.number().int().nonnegative().max(100_000),
    minimumDurationMinutes: z.number().int().min(1).max(1440),
    typicalDurationMinutes: z.number().int().min(1).max(1440),
    maximumDurationMinutes: z.number().int().min(1).max(1440),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.kind === "REFUELING" && rule.scopeType !== "AIRCRAFT") {
      context.addIssue({
        code: "custom",
        message: "Tanken kann nur für ein Flugzeug geplant werden.",
        path: ["scopeType"],
      });
    }
    if (
      rule.minimumDurationMinutes > rule.typicalDurationMinutes ||
      rule.typicalDurationMinutes > rule.maximumDurationMinutes
    ) {
      context.addIssue({
        code: "custom",
        message: "Die Dauer muss als Minimum ≤ Typisch ≤ Maximum angegeben werden.",
        path: ["typicalDurationMinutes"],
      });
    }
  });
export type SimulationRecurringOperationalRule = z.infer<
  typeof simulationRecurringOperationalRuleSchema
>;

const simulationScenarioOperationalModelSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(120),
    gates: z
      .array(
        z
          .object({
            id: masterDataTemplateKeySchema,
            label: z.string().trim().min(2).max(80),
            travelLeadMinutes: z.number().int().min(0).max(30).default(0),
          })
          .strict(),
      )
      .max(100),
    resourceGroups: z
      .array(
        z
          .object({
            id: masterDataTemplateKeySchema,
            name: z.string().trim().min(2).max(100),
            shortCode: z
              .string()
              .trim()
              .regex(/^[A-Z0-9-]{2,8}$/),
            gateId: masterDataTemplateKeySchema,
            automaticPrecallEnabled: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    aircraft: z
      .array(
        z
          .object({
            id: masterDataTemplateKeySchema,
            registration: z
              .string()
              .trim()
              .regex(/^[A-Z0-9-]{3,16}$/),
            aircraftType: z.string().trim().min(2).max(80),
            capacity: z.number().int().min(1).max(100),
            refuelReminderThreshold: z.number().int().min(1).max(100).optional(),
            resourceGroupId: masterDataTemplateKeySchema.optional(),
          })
          .strict(),
      )
      .max(200),
    pilots: z
      .array(
        z
          .object({
            id: masterDataTemplateKeySchema,
            operationalCode: z
              .string()
              .trim()
              .regex(/^[A-Z0-9-]{2,12}$/),
            active: z.boolean(),
          })
          .strict(),
      )
      .max(200),
    products: z
      .array(
        z
          .object({
            id: masterDataTemplateKeySchema,
            name: z.string().trim().min(2).max(100),
            code: z
              .string()
              .trim()
              .regex(/^[A-Z0-9-]{2,12}$/),
            resourceGroupId: masterDataTemplateKeySchema,
            gateId: masterDataTemplateKeySchema,
            referenceCapacity: z.number().int().min(1).max(100),
            // Operative Produkt-Planzeit vom bestätigten Offblock bis zum bestätigten Onblock.
            referenceDurationMinutes: z.number().int().min(1).max(600),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

const simulationScenarioPlannedOperationSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    scopeType: operationalPlanScopeSchema,
    scopeId: masterDataTemplateKeySchema,
    kind: operationalPlanKindSchema,
    effectMode: operationalPlanEffectModeSchema.optional(),
    durationMultiplierPercent: z.number().int().min(110).max(300).nullable().optional(),
    startMode: operationalPlanStartModeSchema,
    earliestStartAt: z.iso.datetime().nullable(),
    latestStartAt: z.iso.datetime().nullable(),
    afterRotationId: masterDataTemplateKeySchema.nullable(),
    unresolvedAfterCurrentRotation: z.boolean(),
    minimumDurationMinutes: z.number().int().min(1).max(1440),
    typicalDurationMinutes: z.number().int().min(1).max(1440),
    maximumDurationMinutes: z.number().int().min(1).max(1440),
    publicNote: z.string().trim().max(160),
  })
  .strict()
  .superRefine((operation, context) => {
    const effectMode = operation.effectMode ?? "BLOCKING";
    if (
      (effectMode === "BLOCKING" && operation.durationMultiplierPercent != null) ||
      (effectMode === "SLOWDOWN" && operation.durationMultiplierPercent == null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Verzögerungsart und Faktor passen nicht zusammen.",
        path: ["durationMultiplierPercent"],
      });
    }
    if (
      operation.minimumDurationMinutes > operation.typicalDurationMinutes ||
      operation.typicalDurationMinutes > operation.maximumDurationMinutes
    ) {
      context.addIssue({
        code: "custom",
        message: "Die Dauer muss als Minimum ≤ Typisch ≤ Maximum angegeben werden.",
        path: ["typicalDurationMinutes"],
      });
    }
    if (operation.startMode === "TIME_WINDOW") {
      if (
        !operation.earliestStartAt ||
        !operation.latestStartAt ||
        Date.parse(operation.earliestStartAt) > Date.parse(operation.latestStartAt) ||
        operation.afterRotationId !== null ||
        operation.unresolvedAfterCurrentRotation
      ) {
        context.addIssue({
          code: "custom",
          message: "Das Startzeitfenster ist unvollständig oder ungültig.",
          path: ["earliestStartAt"],
        });
      }
    } else if (
      operation.earliestStartAt !== null ||
      operation.latestStartAt !== null ||
      (operation.afterRotationId !== null) === operation.unresolvedAfterCurrentRotation
    ) {
      context.addIssue({
        code: "custom",
        message: "Ein umlaufgebundener Beginn benötigt genau einen Bezug.",
        path: ["afterRotationId"],
      });
    }
    if (
      operation.publicNote.length > 0 &&
      !["EVENT", "RESOURCE_GROUP"].includes(operation.scopeType)
    ) {
      context.addIssue({
        code: "custom",
        message: "Öffentliche Hinweise sind nur veranstaltungs- oder gruppenweit zulässig.",
        path: ["publicNote"],
      });
    }
  });

const simulationScenarioRecurringRuleSchema = z
  .object({
    key: masterDataTemplateKeySchema,
    scopeType: recurringOperationalRuleScopeSchema,
    scopeId: masterDataTemplateKeySchema,
    kind: recurringOperationalRuleKindSchema,
    triggerMetric: recurringOperationalRuleTriggerSchema,
    intervalValue: z.number().int().min(1).max(100_000),
    progressValue: z.number().int().nonnegative().max(100_000),
    minimumDurationMinutes: z.number().int().min(1).max(1440),
    typicalDurationMinutes: z.number().int().min(1).max(1440),
    maximumDurationMinutes: z.number().int().min(1).max(1440),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.kind === "REFUELING" && rule.scopeType !== "AIRCRAFT") {
      context.addIssue({
        code: "custom",
        message: "Tanken kann nur für ein Flugzeug geplant werden.",
        path: ["scopeType"],
      });
    }
    if (
      rule.minimumDurationMinutes > rule.typicalDurationMinutes ||
      rule.typicalDurationMinutes > rule.maximumDurationMinutes
    ) {
      context.addIssue({
        code: "custom",
        message: "Die Dauer muss als Minimum ≤ Typisch ≤ Maximum angegeben werden.",
        path: ["typicalDurationMinutes"],
      });
    }
  });

const simulationScenarioVersionTwoConfigSchema = simulationScenarioVersionOneConfigSchema
  .extend({
    adminParameters: simulationScenarioVersionOneConfigSchema.shape.adminParameters
      .extend({
        aircraftCount: z.number().int().min(1).max(200),
      })
      .strict(),
    operationalModel: simulationScenarioOperationalModelSchema.optional(),
    demandByProduct: z
      .record(masterDataTemplateKeySchema, simulationScenarioDemandSchema)
      .optional(),
    plannedOperations: z.array(simulationScenarioPlannedOperationSchema).max(500),
    recurringRules: z.array(simulationScenarioRecurringRuleSchema).max(500),
  })
  .strict()
  .superRefine((config, context) => {
    const model = config.operationalModel;
    if (!model) {
      if (config.adminParameters.aircraftCount > 12) {
        context.addIssue({
          code: "custom",
          message: "Szenarien ohne operative Topologie unterstützen höchstens zwölf Flugzeuge.",
          path: ["adminParameters", "aircraftCount"],
        });
      }
      if (config.demandByProduct !== undefined) {
        context.addIssue({
          code: "custom",
          message: "Produktnachfrage benötigt eine operative Topologie.",
          path: ["demandByProduct"],
        });
      }
      if (config.plannedOperations.length > 0 || config.recurringRules.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Planeinträge und Regeln benötigen eine operative Topologie.",
          path: ["plannedOperations"],
        });
      }
      return;
    }

    addDuplicateIssues(
      context,
      model.gates.map((entry) => entry.id),
      "gates",
      "Gate-Kennung",
    );
    addDuplicateIssues(
      context,
      model.resourceGroups.map((entry) => entry.id),
      "resourceGroups",
      "Ressourcengruppen-Kennung",
    );
    addDuplicateIssues(
      context,
      model.aircraft.map((entry) => entry.id),
      "aircraft",
      "Flugzeug-Kennung",
    );
    addDuplicateIssues(
      context,
      model.pilots.map((entry) => entry.id),
      "pilots",
      "Piloten-Kennung",
    );
    addDuplicateIssues(
      context,
      model.products.map((entry) => entry.id),
      "products",
      "Produkt-Kennung",
    );
    addDuplicateIssues(
      context,
      config.plannedOperations.map((entry) => entry.key),
      "plannedOperations",
      "Planeintrags-Kennung",
    );
    addDuplicateIssues(
      context,
      config.recurringRules.map((entry) => entry.key),
      "recurringRules",
      "Regel-Kennung",
    );

    const gateIds = new Set(model.gates.map((entry) => entry.id));
    const resourceGroupIds = new Set(model.resourceGroups.map((entry) => entry.id));
    const aircraftIds = new Set(model.aircraft.map((entry) => entry.id));
    const pilotIds = new Set(model.pilots.map((entry) => entry.id));
    const productIds = new Set(model.products.map((entry) => entry.id));

    model.resourceGroups.forEach((entry, index) => {
      if (!gateIds.has(entry.gateId)) {
        context.addIssue({
          code: "custom",
          message: "Ressourcengruppe verweist auf kein exportiertes Gate.",
          path: ["operationalModel", "resourceGroups", index, "gateId"],
        });
      }
    });
    model.aircraft.forEach((entry, index) => {
      if (!entry.resourceGroupId || !resourceGroupIds.has(entry.resourceGroupId)) {
        context.addIssue({
          code: "custom",
          message: "Flugzeug verweist auf keine exportierte Ressourcengruppe.",
          path: ["operationalModel", "aircraft", index, "resourceGroupId"],
        });
      }
    });
    model.products.forEach((entry, index) => {
      if (!resourceGroupIds.has(entry.resourceGroupId)) {
        context.addIssue({
          code: "custom",
          message: "Produkt verweist auf keine exportierte Ressourcengruppe.",
          path: ["operationalModel", "products", index, "resourceGroupId"],
        });
      }
      if (!gateIds.has(entry.gateId)) {
        context.addIssue({
          code: "custom",
          message: "Produkt verweist auf kein exportiertes Gate.",
          path: ["operationalModel", "products", index, "gateId"],
        });
      }
    });

    const demandIds = Object.keys(config.demandByProduct ?? {});
    demandIds.forEach((productId) => {
      if (!productIds.has(productId)) {
        context.addIssue({
          code: "custom",
          message: "Nachfrage verweist auf kein exportiertes Produkt.",
          path: ["demandByProduct", productId],
        });
      }
    });
    model.products.forEach((product) => {
      if (!config.demandByProduct?.[product.id]) {
        context.addIssue({
          code: "custom",
          message: "Für ein exportiertes Produkt fehlt die Nachfrage.",
          path: ["demandByProduct", product.id],
        });
      }
    });

    config.plannedOperations.forEach((operation, index) => {
      const targetExists =
        operation.scopeType === "EVENT"
          ? operation.scopeId === "event"
          : operation.scopeType === "RESOURCE_GROUP"
            ? resourceGroupIds.has(operation.scopeId)
            : operation.scopeType === "AIRCRAFT"
              ? aircraftIds.has(operation.scopeId)
              : pilotIds.has(operation.scopeId);
      if (!targetExists) {
        context.addIssue({
          code: "custom",
          message: "Planeintrag verweist auf kein exportiertes Ziel.",
          path: ["plannedOperations", index, "scopeId"],
        });
      }
    });
    config.recurringRules.forEach((rule, index) => {
      const targetExists =
        rule.scopeType === "AIRCRAFT" ? aircraftIds.has(rule.scopeId) : pilotIds.has(rule.scopeId);
      if (!targetExists) {
        context.addIssue({
          code: "custom",
          message: "Wiederkehrende Regel verweist auf kein exportiertes Ziel.",
          path: ["recurringRules", index, "scopeId"],
        });
      }
    });
  });

export const simulationScenarioVersionTwoTemplateSchema = z
  .object({
    format: z.literal("rundflug-simulation-scenario"),
    formatVersion: z.literal(2),
    exportedAt: z.iso.datetime(),
    name: z.string().trim().min(1).max(80),
    config: simulationScenarioVersionTwoConfigSchema,
  })
  .strict();

export const simulationScenarioTemplateSchema = z.discriminatedUnion("formatVersion", [
  simulationScenarioVersionOneTemplateSchema,
  simulationScenarioVersionTwoTemplateSchema,
]);
export type SimulationScenarioTemplate = z.infer<typeof simulationScenarioTemplateSchema>;
export type SimulationScenarioTemplateV2 = z.infer<
  typeof simulationScenarioVersionTwoTemplateSchema
>;

export const simulationPlanExportSchema = z
  .object({
    format: z.literal("rundflug-simulation-plan"),
    formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    exportedAt: z.iso.datetime(),
    source: masterDataTemplateSourceSchema,
    schedule: simulationPlanScheduleSchema,
    masterData: masterDataTemplateSchema,
    plannedOperations: z.array(simulationPlanOperationSchema).max(500),
    recurringRules: z.array(simulationRecurringOperationalRuleSchema).max(500).default([]),
  })
  .strict()
  .superRefine((exported, context) => {
    const resourceGroupKeys = new Set(exported.masterData.resourceGroups.map((entry) => entry.key));
    const aircraftKeys = new Set(exported.masterData.aircraft.map((entry) => entry.key));
    const pilotKeys = new Set(exported.masterData.pilots.map((entry) => entry.key));
    exported.plannedOperations.forEach((operation, index) => {
      const targetExists =
        operation.scopeType === "EVENT"
          ? operation.scopeKey === "event"
          : operation.scopeType === "RESOURCE_GROUP"
            ? resourceGroupKeys.has(operation.scopeKey)
            : operation.scopeType === "AIRCRAFT"
              ? aircraftKeys.has(operation.scopeKey)
              : pilotKeys.has(operation.scopeKey);
      if (!targetExists) {
        context.addIssue({
          code: "custom",
          message: "Der Planeintrag verweist auf kein exportiertes Ziel.",
          path: ["plannedOperations", index, "scopeKey"],
        });
      }
    });
    exported.recurringRules.forEach((rule, index) => {
      const targetExists =
        rule.scopeType === "AIRCRAFT"
          ? aircraftKeys.has(rule.scopeKey)
          : pilotKeys.has(rule.scopeKey);
      if (!targetExists) {
        context.addIssue({
          code: "custom",
          message: "Die wiederkehrende Regel verweist auf kein exportiertes Ziel.",
          path: ["recurringRules", index, "scopeKey"],
        });
      }
    });
    if (exported.formatVersion === 1 && exported.recurringRules.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Wiederkehrende Regeln benötigen Exportformat V2.",
        path: ["formatVersion"],
      });
    }
  });
export type SimulationPlanExport = z.infer<typeof simulationPlanExportSchema>;

export const masterDataTemplateValidationRequestSchema = z
  .object({ template: masterDataTemplateSchema })
  .strict();
export type MasterDataTemplateValidationRequest = z.infer<
  typeof masterDataTemplateValidationRequestSchema
>;

export const masterDataTemplateCountsSchema = z
  .object({
    gates: z.number().int().nonnegative(),
    resourceGroups: z.number().int().nonnegative(),
    aircraft: z.number().int().nonnegative(),
    assignments: z.number().int().nonnegative(),
    pilots: z.number().int().nonnegative(),
    products: z.number().int().nonnegative(),
  })
  .strict();
export type MasterDataTemplateCounts = z.infer<typeof masterDataTemplateCountsSchema>;

export const masterDataTemplateValidationSchema = z
  .object({
    valid: z.boolean(),
    targetEligible: z.boolean(),
    counts: masterDataTemplateCountsSchema,
    errors: z.array(z.object({ path: z.string(), message: z.string() }).strict()),
    warnings: z.array(z.string()),
  })
  .strict();
export type MasterDataTemplateValidation = z.infer<typeof masterDataTemplateValidationSchema>;

export const importMasterDataTemplateRequestSchema = z
  .object({
    commandId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    template: masterDataTemplateSchema,
  })
  .strict();
export type ImportMasterDataTemplateRequest = z.infer<typeof importMasterDataTemplateRequestSchema>;

export const importMasterDataTemplateResponseSchema = z
  .object({
    accepted: z.literal(true),
    duplicate: z.boolean(),
    eventId: z.string(),
    version: z.number().int().nonnegative(),
    counts: masterDataTemplateCountsSchema,
  })
  .strict();
export type ImportMasterDataTemplateResponse = z.infer<
  typeof importMasterDataTemplateResponseSchema
>;

export const adminEventFlowPointSchema = z
  .object({
    at: z.iso.datetime(),
    soldTickets: z.number().int().nonnegative(),
    completedTickets: z.number().int().nonnegative(),
    openTickets: z.number().int().nonnegative(),
  })
  .strict();

export const adminEventFlowSchema = z
  .object({
    eventId: z.string(),
    from: z.iso.datetime(),
    plannedUntil: z.iso.datetime(),
    observedUntil: z.iso.datetime(),
    bucketMinutes: z.number().int().positive(),
    points: z.array(adminEventFlowPointSchema).max(96),
  })
  .strict();
export type AdminEventFlowPoint = z.infer<typeof adminEventFlowPointSchema>;
export type AdminEventFlow = z.infer<typeof adminEventFlowSchema>;

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
        "TICKET_GROUP_RECALL",
        "ROTATION",
        "RECOVERY_BATCH",
        "OPERATIONAL_PLAN",
        "OPERATIONAL_RULE",
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
  // Operative Produkt-Planzeit vom bestätigten Offblock bis zum bestätigten Onblock.
  referenceDurationMinutes: z.number().int().positive(),
  // Gegenüber Gästen kommunizierte Produktzeit ohne Wirkung auf die operative Prognose.
  promisedFlightMinutes: z.number().int().positive(),
  plannedBoardingMinutesOverride: turnaroundPhaseOverrideValueSchema,
  plannedDeboardingMinutesOverride: turnaroundPhaseOverrideValueSchema,
  plannedBufferMinutesOverride: turnaroundPhaseOverrideValueSchema,
  effectiveTurnaroundProfile: z.object({
    boarding: z.object({
      valueMinutes: z.number().int().nonnegative(),
      sourceLevel: z.enum(["AIRCRAFT_PRODUCT", "PRODUCT", "EVENT"]),
      sourceId: z.string(),
    }),
    deboarding: z.object({
      valueMinutes: z.number().int().nonnegative(),
      sourceLevel: z.enum(["AIRCRAFT_PRODUCT", "PRODUCT", "EVENT"]),
      sourceId: z.string(),
    }),
    buffer: z.object({
      valueMinutes: z.number().int().nonnegative(),
      sourceLevel: z.enum(["AIRCRAFT_PRODUCT", "PRODUCT", "EVENT"]),
      sourceId: z.string(),
    }),
    totalGroundMinutes: z.number().int().nonnegative(),
  }),
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
  predictedLowerMinutes: z.number().int().nonnegative().nullable(),
  predictedUpperMinutes: z.number().int().nonnegative().nullable(),
  boardingWindowLowerAt: z.iso.datetime().nullable(),
  boardingWindowUpperAt: z.iso.datetime().nullable(),
  precalledAt: z.string().nullable().optional(),
  precallDecision: z
    .object({
      status: z.enum(["WAITING", "PREPARE", "GO_TO_GATE"]),
      reason: z.enum([
        "ELIGIBLE",
        "DISABLED",
        "OPERATIONS_BLOCKED",
        "NOT_QUEUE_FRONT",
        "ALREADY_PRECALLED",
        "NO_FORECAST_CAPACITY",
        "NO_FITTING_AIRCRAFT",
        "NOT_IN_NEAR_DISPATCH_BATCH",
        "GATE_CAPACITY_COVERED",
        "WAITING_FOR_PRODUCT_FAIRNESS",
        "WAITING_FOR_FITTING_LANE",
        "COMMITMENT_LOCKED",
        "DISPATCH_PLAN_STALE",
        "TOO_EARLY",
      ]),
      decidedAt: z.string(),
      predictedBoardingAt: z.string().nullable(),
      adaptiveLeadMinutes: z.number().int().nonnegative().nullable(),
      gateId: z.string().nullable().default(null),
      adaptiveBaseLeadMinutes: z.number().int().nonnegative().nullable().default(null),
      gateTravelLeadMinutes: z.number().int().min(0).max(30).nullable().default(null),
      effectiveLeadMinutes: z.number().int().nonnegative().nullable().default(null),
      boardingWindowLowerAt: z.string().nullable().default(null),
      boardingWindowUpperAt: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
  calledAt: z.string().nullable(),
  dispatchPlan: z
    .object({
      planId: z.string(),
      revision: z.string(),
      batchId: z.string().nullable(),
      dispatchOrder: z.number().int().positive().nullable(),
      wave: z.number().int().positive().nullable(),
      laneId: z.string().nullable(),
      groupIds: z.array(z.string()),
      occupiedSeats: z.number().int().positive().nullable(),
      availableSeats: z.number().int().nonnegative().nullable(),
      commitmentLevel: z.enum(["WAITING", "PREPARE", "COME_TO_FLIGHT_LINE"]).nullable(),
      decisionReasons: z.array(
        z.enum([
          "HARD_COMMITMENT",
          "MUST_SERVE_MAX_WAIT",
          "MUST_SERVE_MAX_OVERTAKES",
          "PRODUCT_FAIRNESS",
          "CAPACITY_OPTIMIZED",
          "QUEUE_ORDER",
          "PLAN_STABILITY",
          "STANDBY_PRIORITY",
        ]),
      ),
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
    .nullable()
    .optional(),
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
    forecastAssumedAircraftId: z.string().nullable().optional(),
    extendsBeyondOperationsEnd: z.boolean(),
    overtimeMinutes: z.number().int().nonnegative(),
    effectiveTurnaroundProfile: productOperationalSummarySchema.shape.effectiveTurnaroundProfile
      .nullable()
      .optional(),
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

export const plannedOperationalConstraintSchema = z.object({
  id: z.string(),
  version: z.number().int().nonnegative(),
  scopeType: operationalPlanScopeSchema,
  scopeId: z.string(),
  kind: operationalPlanKindSchema,
  effectMode: operationalPlanEffectModeSchema,
  durationMultiplierPercent: z.number().int().min(110).max(300).nullable(),
  startMode: operationalPlanStartModeSchema,
  earliestStartAt: z.string().nullable(),
  latestStartAt: z.string().nullable(),
  afterRotationId: z.string().nullable(),
  minimumDurationMinutes: z.number().int().positive(),
  typicalDurationMinutes: z.number().int().positive(),
  maximumDurationMinutes: z.number().int().positive(),
  status: operationalPlanStatusSchema,
  publicNote: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activatedAt: z.string().nullable(),
  clearedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  recurringRuleId: z.string().nullable().default(null),
  recurrenceSequence: z.number().int().positive().nullable().default(null),
});
export type PlannedOperationalConstraint = z.infer<typeof plannedOperationalConstraintSchema>;

export const recurringOperationalRuleSchema = z.object({
  id: z.string(),
  operationDayId: z.string(),
  version: z.number().int().nonnegative(),
  scopeType: recurringOperationalRuleScopeSchema,
  scopeId: z.string(),
  kind: recurringOperationalRuleKindSchema,
  triggerMetric: recurringOperationalRuleTriggerSchema,
  intervalValue: z.number().int().positive(),
  progressValue: z.number().int().nonnegative(),
  minimumDurationMinutes: z.number().int().positive(),
  typicalDurationMinutes: z.number().int().positive(),
  maximumDurationMinutes: z.number().int().positive(),
  status: recurringOperationalRuleStatusSchema,
  sequenceNumber: z.number().int().nonnegative(),
  openPlannedOperationId: z.string().nullable(),
  reason: z.string().nullable(),
  lastResetAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RecurringOperationalRule = z.infer<typeof recurringOperationalRuleSchema>;

export const operationBoardSchema = z.object({
  currentDeviceRole: z.enum(["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]),
  event: eventSnapshotSchema,
  products: z.array(productOperationalSummarySchema),
  aircraftProductTurnaroundOverrides: z
    .array(
      z.object({
        aircraftId: z.string(),
        productId: z.string(),
        version: z.number().int().nonnegative(),
        plannedBoardingMinutesOverride: turnaroundPhaseOverrideValueSchema,
        plannedDeboardingMinutesOverride: turnaroundPhaseOverrideValueSchema,
        plannedBufferMinutesOverride: turnaroundPhaseOverrideValueSchema,
        effectiveTurnaroundProfile:
          productOperationalSummarySchema.shape.effectiveTurnaroundProfile,
      }),
    )
    .default([]),
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
        precalledAt: z.string().nullable().default(null),
        dispatchReservation: z.enum(["OWN", "OTHER"]).nullable().default(null),
        recalledAt: z.string().nullable(),
        recallCount: z.number().int().nonnegative(),
        activeRecall: ticketGroupRecallProjectionSchema.nullable(),
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
  plannedOperations: z.array(plannedOperationalConstraintSchema).default([]),
  recurringOperationalRules: z.array(recurringOperationalRuleSchema).default([]),
  gates: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      gateType: z.enum(["FLIGHT_LINE", "BOARDING", "DISPLAY_ONLY"]),
      active: z.boolean(),
      sortOrder: z.number().int().nonnegative(),
      travelLeadMinutes: z.number().int().min(0).max(30),
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
      operationalNote: z.string().trim().max(240),
      gateId: z.string(),
      gateLabel: z.string(),
      referenceCapacity: z.number().int().positive(),
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

export const analysisPrivacyProfileSchema = z.literal("SUPPORT_SAFE");
export type AnalysisPrivacyProfile = z.infer<typeof analysisPrivacyProfileSchema>;

export const planningCaptureMetadataSchema = z
  .object({
    mode: z.enum(["REFERENCE", "CHANGE", "ANCHOR"]),
    contextId: z.string().min(1),
    anchorRunId: z.string().min(1),
    replayDistance: z.number().int().min(0).max(10),
  })
  .strict();
export type PlanningCaptureMetadata = z.infer<typeof planningCaptureMetadataSchema>;

const analysisUiEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("AIRCRAFT_SELECTED"),
      occurredAt: z.string().datetime(),
      aircraftId: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ASSIGNMENT_DIALOG_OPENED"),
      occurredAt: z.string().datetime(),
      rotationId: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("DISPATCH_RECOMMENDATION_APPLIED"),
      occurredAt: z.string().datetime(),
      planRevision: z.string(),
      batchId: z.string(),
      groupIds: z.array(z.string()).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal("QUEUE_GROUP_SELECTION_CHANGED"),
      occurredAt: z.string().datetime(),
      groupIds: z.array(z.string()).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal("ASSIGNMENT_DIALOG_CLOSED"),
      occurredAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ANALYSIS_EXPORT_STARTED"),
      occurredAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ANALYSIS_EXPORT_COMPLETED"),
      occurredAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ANALYSIS_EXPORT_FAILED"),
      occurredAt: z.string().datetime(),
    })
    .strict(),
]);
export type AnalysisUiEvent = z.infer<typeof analysisUiEventSchema>;

export const analysisClientContextSchema = z
  .object({
    capturedAt: z.string().datetime(),
    route: z
      .string()
      .max(256)
      .regex(/^\/[a-zA-Z0-9/_-]*$/),
    selectedAircraftId: z.string().nullable(),
    selectedRotationId: z.string().nullable(),
    selectedQueueGroupIds: z.array(z.string()).max(50),
    assignmentDialogOpen: z.boolean(),
    visibleRecommendation: z
      .object({
        planRevision: z.string(),
        batchId: z.string(),
        groupIds: z.array(z.string()).max(50),
      })
      .strict()
      .nullable(),
    connectionState: z.enum(["CONNECTED", "STALE", "OFFLINE"]),
    viewport: z
      .object({
        width: z.number().int().nonnegative(),
        height: z.number().int().nonnegative(),
        devicePixelRatio: z.number().positive().max(10),
      })
      .strict(),
    displayMode: z.enum(["BROWSER", "PWA"]),
    browserFamily: z.enum(["CHROME", "EDGE", "FIREFOX", "SAFARI", "OTHER"]),
    browserMajorVersion: z.number().int().positive().nullable(),
    recentUiEvents: z.array(analysisUiEventSchema).max(100),
  })
  .strict();
export type AnalysisClientContext = z.infer<typeof analysisClientContextSchema>;

const analysisPlanningManifestEntrySchema = z
  .object({
    kind: z.enum([
      "EVENT_CONFIGURATION",
      "ROTATIONS_QUEUE",
      "CAPACITIES",
      "DURATION_SAMPLES",
      "OPERATIONAL_CONSTRAINTS",
    ]),
    partitionKey: z.string(),
    chunkId: z.string(),
  })
  .strict();

const analysisPlanningChunkSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      "EVENT_CONFIGURATION",
      "ROTATIONS_QUEUE",
      "CAPACITIES",
      "DURATION_SAMPLES",
      "OPERATIONAL_CONSTRAINTS",
      "PREVIOUS_FORECAST_STATE",
      "PREVIOUS_DISPATCH_STATE",
      "DISPATCH_RESULT",
      "PRECALL_RESULT",
    ]),
    schemaVersion: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().nonnegative(),
    payload: z.json(),
  })
  .strict();

const analysisForecastSnapshotSchema = z
  .object({
    id: z.string(),
    planningRunId: z.string(),
    rotationId: z.string(),
    capturedAt: z.string().datetime(),
    quality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
    lowerMinutes: z.number().nonnegative(),
    upperMinutes: z.number().nonnegative(),
    predictedBoardingAt: z.string().nullable(),
    predictedDepartureAt: z.string().nullable(),
    predictedLandingAt: z.string().nullable(),
    predictedCompletionAt: z.string().nullable(),
    dispatchPlanRevision: z.string().nullable(),
  })
  .strict();

export const analysisSnapshotManifestSchema = z
  .object({
    exportId: z.string(),
    capturedAt: z.string().datetime(),
    applicationVersion: z.string(),
    requirementsVersion: z.string(),
    sourceRevision: z.string(),
    environment: appEnvironmentSchema,
    privacyProfile: analysisPrivacyProfileSchema,
    eventId: z.string(),
    eventVersion: z.number().int().nonnegative(),
    eventDate: z.string(),
    timeZone: z.string(),
    planningRunId: z.string(),
    planningRunEventVersion: z.number().int().nonnegative(),
    dispatchPlanRevision: z.string(),
    schemaVersions: z
      .object({
        snapshot: z.literal(1),
        planningContext: z.number().int().positive(),
        planningRun: z.literal(1),
      })
      .strict(),
  })
  .strict();

export const analysisSnapshotSchema = z
  .object({
    format: z.literal("rundflug-analysis-snapshot"),
    formatVersion: z.literal(1),
    manifest: analysisSnapshotManifestSchema,
    currentState: z
      .object({
        operationBoard: z.json(),
      })
      .strict(),
    planning: z
      .object({
        metadata: planningCaptureMetadataSchema,
        run: z
          .object({
            id: z.string(),
            eventVersion: z.number().int().nonnegative(),
            calculationNow: z.string().datetime(),
            capturedAt: z.string().datetime(),
            trigger: z.string(),
            sourceRevision: z.string(),
            dispatchPlanRevision: z.string(),
            forecastDigest: z.string().regex(/^[a-f0-9]{64}$/),
            precallDigest: z.string().regex(/^[a-f0-9]{64}$/),
            durationMs: z.number().nonnegative(),
            captureDurationMs: z.number().nonnegative(),
          })
          .strict(),
        replayChain: z
          .array(
            z
              .object({
                id: z.string(),
                previousRunId: z.string().nullable(),
                anchorRunId: z.string(),
                contextId: z.string(),
                eventVersion: z.number().int().nonnegative(),
                replayDistance: z.number().int().min(0).max(10),
                calculationNow: z.string().datetime(),
                capturedAt: z.string().datetime(),
                trigger: z.string(),
                mode: z.enum(["REFERENCE", "CHANGE", "ANCHOR"]),
                sourceRevision: z.string(),
                dispatchPlanRevision: z.string(),
                forecastDigest: z.string().regex(/^[a-f0-9]{64}$/),
                precallDigest: z.string().regex(/^[a-f0-9]{64}$/),
                previousForecastStateChunkId: z.string().nullable(),
                previousDispatchStateChunkId: z.string().nullable(),
                dispatchResultChunkId: z.string().nullable(),
                precallResultChunkId: z.string().nullable(),
              })
              .strict(),
          )
          .min(1)
          .max(11),
        context: z
          .object({
            id: z.string(),
            eventVersion: z.number().int().nonnegative(),
            schemaVersion: z.number().int().positive(),
            manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
            manifest: z.array(analysisPlanningManifestEntrySchema),
          })
          .strict(),
        chunks: z.array(analysisPlanningChunkSchema),
        forecastSnapshots: z.array(analysisForecastSnapshotSchema),
      })
      .strict(),
    client: analysisClientContextSchema.nullable(),
  })
  .strict();
export type AnalysisSnapshot = z.infer<typeof analysisSnapshotSchema>;

export const analysisArchiveStatusSchema = z.enum([
  "PENDING",
  "BUILDING",
  "READY",
  "FAILED",
  "EXPIRED",
  "DELETED",
]);
export type AnalysisArchiveStatus = z.infer<typeof analysisArchiveStatusSchema>;

export const analysisArchiveRequestSchema = z
  .object({
    requestId: z.uuid(),
    expectedEventVersion: z.number().int().nonnegative(),
  })
  .strict();
export type AnalysisArchiveRequest = z.infer<typeof analysisArchiveRequestSchema>;

export const analysisArchiveSchema = z
  .object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    eventVersion: z.number().int().nonnegative(),
    privacyProfile: analysisPrivacyProfileSchema,
    formatVersion: z.literal(1),
    status: analysisArchiveStatusSchema,
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime(),
    sizeBytes: z.number().int().nonnegative().nullable(),
    failureCode: z.string().nullable(),
  })
  .strict();
export type AnalysisArchive = z.infer<typeof analysisArchiveSchema>;

export const analysisArchiveListSchema = z
  .object({ archives: z.array(analysisArchiveSchema) })
  .strict();
export type AnalysisArchiveList = z.infer<typeof analysisArchiveListSchema>;

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

export const dispatchRecommendationLeaseAcquireSchema = z
  .object({
    commandId: z.uuid(),
    aircraftId: z.string().min(1).max(100),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type DispatchRecommendationLeaseAcquire = z.infer<
  typeof dispatchRecommendationLeaseAcquireSchema
>;

export const dispatchRecommendationLeaseSchema = z
  .object({
    leaseId: z.uuid(),
    aircraftId: z.string().min(1).max(100),
    planRevision: z.string().min(1).max(100),
    batchId: z.string().min(1).max(100),
    dispatchOrder: z.number().int().positive(),
    groupIds: z.array(z.string().min(1).max(100)).min(1).max(12),
    occupiedSeats: z.number().int().positive(),
    availableSeats: z.number().int().nonnegative(),
    decisionReasons: z.array(z.string().min(1).max(100)).max(20),
    acquiredAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    serverNow: z.iso.datetime(),
  })
  .strict();
export type DispatchRecommendationLease = z.infer<typeof dispatchRecommendationLeaseSchema>;

export const bookingGroupPartContextSchema = z
  .object({
    partNumber: z.number().int().positive(),
    partCount: z.number().int().positive(),
    passengerCount: z.number().int().positive(),
  })
  .strict();
export type BookingGroupPartContext = z.infer<typeof bookingGroupPartContextSchema>;

export const forecastStateSchema = z.enum([
  "DISPATCH_WINDOW",
  "LONG_RANGE_WINDOW",
  "AFTER_OPERATIONS_END",
  "UNAVAILABLE",
]);
export type ForecastState = z.infer<typeof forecastStateSchema>;

export const publicForecastReasonSchema = z.enum([
  "RETURN_TIME_UNKNOWN",
  "NO_MATCHING_CAPACITY",
  "STATUS_CLARIFICATION",
  "OPERATIONS_INTERRUPTED",
  "EMERGENCY_MODE",
  "RESOURCE_GROUP_UNAVAILABLE",
]);
export type PublicForecastReason = z.infer<typeof publicForecastReasonSchema>;

export const publicTicketStatusSchema = z
  .object({
    eventId: z.string(),
    eventName: z.string(),
    productName: z.string(),
    productCode: z.string(),
    publicDescription: z.string(),
    gateLabel: z.string(),
    communicationNumber: z.number().int().positive(),
    bookingGroupPart: bookingGroupPartContextSchema.nullable(),
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
    forecastState: forecastStateSchema,
    forecastReason: publicForecastReasonSchema.nullable(),
    timeZone: timeZoneSchema,
    predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
    message: z.string(),
    operationalNotice: z.string(),
    activeRecall: ticketGroupRecallProjectionSchema.nullable(),
    updatedAt: z.string(),
  })
  .strict();
export type PublicTicketStatus = z.infer<typeof publicTicketStatusSchema>;

export const publicBoardGroupSchema = z
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
      "PREPARE",
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
    forecastState: forecastStateSchema,
    forecastReason: publicForecastReasonSchema.nullable(),
    dispatchOrder: z.number().int().positive().nullable().default(null),
    predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
    operationalNotice: z.string(),
    activeRecall: ticketGroupRecallProjectionSchema.nullable(),
  })
  .strict();
export type PublicBoardGroup = z.infer<typeof publicBoardGroupSchema>;

export const fidsBoardRowSchema = publicBoardGroupSchema
  .extend({
    rowId: z.string().min(1).max(100),
    productId: z.string().min(1).max(100),
    gateId: z.string().min(1).max(100).nullable(),
    bookingGroupLabels: z.array(z.string().min(1).max(80)).min(1).max(3).optional(),
    sharedFlightKey: z.string().min(1).max(120).nullable().optional(),
  })
  .strict();
export type FidsBoardRow = z.infer<typeof fidsBoardRowSchema>;

export const fidsFilterOptionsSchema = z
  .object({
    gates: z.array(
      z
        .object({
          id: z.string().min(1).max(100),
          label: z.string().min(1).max(160),
          active: z.boolean(),
        })
        .strict(),
    ),
    products: z.array(
      z
        .object({
          id: z.string().min(1).max(100),
          code: z.string().min(1).max(40),
          name: z.string().min(1).max(160),
          gateId: z.string().min(1).max(100),
          active: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type FidsFilterOptions = z.infer<typeof fidsFilterOptionsSchema>;

const fidsPageSchema = z
  .object({
    requestedPage: z.number().int().min(1).max(999),
    pageSize: z.number().int().min(0).max(20),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    groups: z.array(fidsBoardRowSchema),
  })
  .strict();

export const fidsBoardResponseSchema = z
  .object({
    eventName: z.string(),
    timeZone: timeZoneSchema,
    emergencyMode: z.boolean(),
    operationalInterrupted: z.boolean(),
    operationalNotice: z.string(),
    departedVisibilitySeconds: z.number().int().min(5).max(900).default(15),
    updatedAt: z.string(),
    preferencesVersion: z.number().int().nonnegative(),
    viewMode: fidsViewModeSchema,
    filterSummary: fidsContentFilterSchema,
    priority: z
      .object({
        configuredCapacity: z.number().int().min(1).max(19),
        effectiveCapacity: z.number().int().min(0).max(20),
        totalItems: z.number().int().nonnegative(),
        overflowCount: z.number().int().nonnegative(),
        groups: z.array(fidsBoardRowSchema),
      })
      .strict()
      .nullable(),
    page: fidsPageSchema,
    fleet: z.array(
      z
        .object({
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
        })
        .strict(),
    ),
  })
  .strict();
export type FidsBoardResponse = z.infer<typeof fidsBoardResponseSchema>;

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
  groups: z.array(publicBoardGroupSchema),
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

const publicGroupPartSchema = bookingGroupPartContextSchema
  .extend({
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
    forecastState: forecastStateSchema,
    forecastReason: publicForecastReasonSchema.nullable(),
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
    activeRecall: ticketGroupRecallProjectionSchema.nullable(),
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
