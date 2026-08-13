import { simulationPlanExportSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import { loadMasterDataExportProjection } from "./master-data-export";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

interface PlannedOperationRow {
  id: string;
  scope_type: "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT";
  scope_id: string;
  constraint_kind: "PAUSE" | "REFUELING" | "FLIGHT_SHOW" | "WEATHER" | "TECHNICAL" | "OTHER";
  effect_mode: "BLOCKING" | "SLOWDOWN";
  duration_multiplier_percent: number | null;
  start_mode: "TIME_WINDOW" | "AFTER_CURRENT_ROTATION";
  earliest_start_at: string | null;
  latest_start_at: string | null;
  after_rotation_id: string | null;
  minimum_duration_minutes: number;
  typical_duration_minutes: number;
  maximum_duration_minutes: number;
  public_note: string;
}

interface RecurringRuleRow {
  id: string;
  scope_type: "AIRCRAFT" | "PILOT";
  scope_id: string;
  operation_kind: "PAUSE" | "REFUELING";
  trigger_metric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
  interval_value: number;
  progress_value: number;
  minimum_duration_minutes: number;
  typical_duration_minutes: number;
  maximum_duration_minutes: number;
}

const defaultDependencies = {
  authorizeDevice,
  loadMasterDataExportProjection,
  now: () => new Date(),
};

type SimulationPlanExportRouteDependencies = typeof defaultDependencies;

export function registerSimulationPlanExportRoutes(
  app: WorkerApp,
  dependencies: SimulationPlanExportRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/exports/simulation-plan.json", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (!device || !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)) {
      return context.json(
        {
          error: {
            code: "SESSION_NOT_AUTHORIZED",
            message: "Sitzung für diesen Simulationsexport nicht berechtigt.",
          },
        },
        403,
      );
    }

    const exportedAt = dependencies.now().toISOString();
    const [projection, plans, recurringRules] = await Promise.all([
      dependencies.loadMasterDataExportProjection(context.env.DB, eventId, exportedAt),
      context.env.DB.prepare(
        `SELECT id, scope_type, scope_id, constraint_kind, effect_mode,
                duration_multiplier_percent, start_mode,
                earliest_start_at, latest_start_at, after_rotation_id,
                minimum_duration_minutes, typical_duration_minutes, maximum_duration_minutes,
                public_note
           FROM planned_operational_constraints
          WHERE operation_day_id = ?1 AND status = 'PLANNED' AND recurring_rule_id IS NULL
          ORDER BY COALESCE(earliest_start_at, created_at), created_at, id`,
      )
        .bind(eventId)
        .all<PlannedOperationRow>(),
      context.env.DB.prepare(
        `SELECT id, scope_type, scope_id, operation_kind, trigger_metric, interval_value,
                progress_value, minimum_duration_minutes, typical_duration_minutes,
                maximum_duration_minutes
           FROM recurring_operational_rules
          WHERE operation_day_id = ?1 AND status = 'ACTIVE'
          ORDER BY scope_type, scope_id, operation_kind, id`,
      )
        .bind(eventId)
        .all<RecurringRuleRow>(),
    ]);

    if (!projection) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    if (!projection.schedule) {
      return context.json(
        {
          error: {
            code: "SIMULATION_SCHEDULE_INCOMPLETE",
            message: "Verkaufs- und Betriebszeiten müssen vor dem Export vollständig sein.",
          },
        },
        409,
      );
    }

    const plannedOperations = plans.results.map((plan, index) => {
      let scopeKey = projection.keys.pilots.get(plan.scope_id);
      if (plan.scope_type === "EVENT") scopeKey = "event";
      else if (plan.scope_type === "RESOURCE_GROUP") {
        scopeKey = projection.keys.resourceGroups.get(plan.scope_id);
      } else if (plan.scope_type === "AIRCRAFT") {
        scopeKey = projection.keys.aircraft.get(plan.scope_id);
      }
      if (!scopeKey) {
        throw new Error(`Simulationsexport: Ziel für Planeintrag ${plan.id} fehlt.`);
      }
      return {
        key: `plan-${index + 1}`,
        scopeType: plan.scope_type,
        scopeKey,
        kind: plan.constraint_kind,
        effectMode: plan.effect_mode,
        durationMultiplierPercent: plan.duration_multiplier_percent,
        startMode: plan.start_mode,
        earliestStartAt: plan.earliest_start_at,
        latestStartAt: plan.latest_start_at,
        afterCurrentRotation: plan.after_rotation_id !== null,
        minimumDurationMinutes: plan.minimum_duration_minutes,
        typicalDurationMinutes: plan.typical_duration_minutes,
        maximumDurationMinutes: plan.maximum_duration_minutes,
        publicNote: plan.public_note,
      };
    });
    const simulationPlan = simulationPlanExportSchema.parse({
      format: "rundflug-simulation-plan",
      formatVersion: 3,
      exportedAt,
      source: projection.template.source,
      schedule: projection.schedule,
      masterData: projection.template,
      plannedOperations,
      recurringRules: recurringRules.results.map((rule, index) => {
        const scopeKey =
          rule.scope_type === "AIRCRAFT"
            ? projection.keys.aircraft.get(rule.scope_id)
            : projection.keys.pilots.get(rule.scope_id);
        if (!scopeKey) {
          throw new Error(`Simulationsexport: Ziel für Regel ${rule.id} fehlt.`);
        }
        return {
          key: `rule-${index + 1}`,
          scopeType: rule.scope_type,
          scopeKey,
          kind: rule.operation_kind,
          triggerMetric: rule.trigger_metric,
          intervalValue: rule.interval_value,
          progressValue: rule.progress_value,
          minimumDurationMinutes: rule.minimum_duration_minutes,
          typicalDurationMinutes: rule.typical_duration_minutes,
          maximumDurationMinutes: rule.maximum_duration_minutes,
        };
      }),
    });
    return context.json(simulationPlan, 200, {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="simulationsplan-${eventId}.json"`,
    });
  });
}
