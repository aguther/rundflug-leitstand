import { z } from "zod";

import { commandBaseSchema } from "./operation-command-base";

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

export const planningCommandSchemas = [
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
] as const;

export type PlanningCommand = z.infer<(typeof planningCommandSchemas)[number]>;
