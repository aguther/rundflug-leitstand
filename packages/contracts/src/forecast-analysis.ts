import { z } from "zod";
import { plannedTargetExists } from "./forecast-analysis-validation";
import { masterDataTemplateSchema } from "./master-data";

import {
  operationalPlanEffectModeSchema,
  operationalPlanKindSchema,
  operationalPlanScopeSchema,
  operationalPlanStartModeSchema,
  recurringOperationalRuleKindSchema,
  recurringOperationalRuleScopeSchema,
  recurringOperationalRuleTriggerSchema,
} from "./operations-dispatch";

import {
  addDuplicateIssues,
  masterDataTemplateKeySchema,
  masterDataTemplateSourceSchema,
} from "./schema-helpers";

import { appEnvironmentSchema, timeZoneSchema } from "./shared";

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
      const targetExists = plannedTargetExists(operation.scopeType, operation.scopeId, {
        resourceGroups: resourceGroupIds,
        aircraft: aircraftIds,
        pilots: pilotIds,
      });
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
      const targetExists = plannedTargetExists(operation.scopeType, operation.scopeKey, {
        resourceGroups: resourceGroupKeys,
        aircraft: aircraftKeys,
        pilots: pilotKeys,
      });
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

export const analysisSnapshotRequestSchema = z
  .object({
    requestId: z.uuid(),
    expectedEventVersion: z.number().int().nonnegative(),
  })
  .strict();
export type AnalysisSnapshotRequest = z.infer<typeof analysisSnapshotRequestSchema>;

export const analysisSnapshotCaptureReceiptSchema = z
  .object({
    expectedEventVersion: z.number().int().nonnegative(),
    planningRunId: z.uuid(),
    eventVersion: z.number().int().nonnegative(),
    dispatchPlanRevision: z.string().min(1),
  })
  .strict();
export type AnalysisSnapshotCaptureReceipt = z.infer<typeof analysisSnapshotCaptureReceiptSchema>;

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
    formatVersion: z.union([z.literal(1), z.literal(2)]),
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
