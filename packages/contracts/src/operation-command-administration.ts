import { z } from "zod";

import { commandBaseSchema } from "./operation-command-base";
import { outageRecoveryEntrySchema } from "./reports-recovery";
import { productWeightClassSchema, turnaroundPhaseOverrideValueSchema } from "./schema-helpers";
import { gateDisplayFilterSchema } from "./shared";

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

export const administrationCommandSchemas = [
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
] as const;

export type AdministrationCommand = z.infer<(typeof administrationCommandSchemas)[number]>;
