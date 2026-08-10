import { z } from "zod";

import { eventSnapshotSchema } from "./event-auth";

import { outageRecoveryEntrySchema } from "./reports-recovery";

import { productWeightClassSchema, turnaroundPhaseOverrideValueSchema } from "./schema-helpers";

import { gateDisplayFilterSchema } from "./shared";

import {
  ticketGroupPrintDataSchema,
  ticketGroupRecallProjectionSchema,
} from "./tickets-public-status";

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

const rotationBookingGroupSchema = z
  .object({
    id: z.string(),
    communicationNumber: z.number().int().positive(),
    soldAt: z.string(),
    ticketCount: z.number().int().positive(),
    presentCount: z.number().int().nonnegative(),
    partNumber: z.number().int().positive().default(1),
    partCount: z.number().int().positive().default(1),
  })
  .refine((group) => group.partNumber <= group.partCount, {
    message: "Booking group part number must not exceed its part count",
    path: ["partNumber"],
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
  bookingGroups: z.array(rotationBookingGroupSchema).default([]),
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
