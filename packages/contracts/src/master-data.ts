import { z } from "zod";
import {
  addDuplicateIssues,
  masterDataTemplateKeySchema,
  masterDataTemplateSourceSchema,
  productWeightClassSchema,
  turnaroundPhaseOverrideValueSchema,
} from "./schema-helpers";
import { gateDisplayFilterSchema } from "./shared";

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
