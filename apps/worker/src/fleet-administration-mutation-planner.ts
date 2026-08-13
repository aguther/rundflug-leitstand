import type { CommandEnvelope } from "@rundflug/contracts";
import {
  type AircraftOperationalState,
  DomainRuleError,
  transitionAircraft,
} from "@rundflug/domain";
import type { Env } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

function completedOperationalKind(state: AircraftOperationalState): "REFUELING" | "PAUSE" | null {
  if (state === "REFUELING") return "REFUELING";
  if (state === "PAUSED") return "PAUSE";
  return null;
}

function operationalBlockType(
  state: AircraftOperationalState,
): "REFUELING" | "PAUSE" | "INTERRUPTION" {
  if (state === "REFUELING") return "REFUELING";
  if (state === "PAUSED") return "PAUSE";
  return "INTERRUPTION";
}

type PilotPauseCommand = Extract<CommandEnvelope, { type: "SET_PILOT_PAUSE" }>;
type PilotUpsertCommand = Extract<CommandEnvelope, { type: "UPSERT_PILOT" }>;
type AircraftStateCommand = Extract<CommandEnvelope, { type: "SET_AIRCRAFT_OPERATIONAL_STATE" }>;
type AircraftFleetCommand = Extract<
  CommandEnvelope,
  {
    type:
      | "SET_AIRCRAFT_OPERATIONAL_STATE"
      | "SCHEDULE_AIRCRAFT_REFUEL"
      | "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD";
  }
>;

interface StoredFleetAircraft {
  id: string;
  operational_state: AircraftOperationalState;
  rotations_since_refuel: number;
  refuel_planned: number;
  operational_interrupted: number;
}

interface FleetMutationPlan {
  aggregateType: "AIRCRAFT" | "PILOT";
  aggregateId: string;
  eventType: string;
  auditPayload: Record<string, unknown>;
  statements: D1PreparedStatement[];
}

export class FleetAdministrationMutationPlanner {
  constructor(private readonly env: Env) {}

  async preparePilotPause(
    command: PilotPauseCommand,
    now: string,
  ): Promise<FleetMutationPlan | Response> {
    const pilot = await this.env.DB.prepare(
      "SELECT id, operational_code, active, paused FROM pilots WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.pilotId, command.eventId)
      .first<{ id: string; operational_code: string; active: number; paused: number }>();
    if (!pilot) {
      return json(
        { error: { code: "PILOT_NOT_FOUND", message: "Pilotencode nicht gefunden." } },
        { status: 404 },
      );
    }
    if (command.payload.paused) {
      const activeRotation = await this.env.DB.prepare(
        `SELECT id FROM rotations WHERE operation_day_id = ?1 AND pilot_id = ?2
          AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED') LIMIT 1`,
      )
        .bind(command.eventId, pilot.id)
        .first<{ id: string }>();
      if (activeRotation) {
        return json(
          {
            error: {
              code: "PILOT_ASSIGNED_ACTIVE_ROTATION",
              message: "Pilotencode ist noch an einen aktiven Umlauf gebunden.",
            },
          },
          { status: 409 },
        );
      }
    }
    const statements = [
      this.env.DB.prepare(
        `UPDATE pilots SET paused = ?1, pause_expected_review_at = ?2, updated_at = ?3
          WHERE id = ?4 AND operation_day_id = ?5`,
      ).bind(
        command.payload.paused ? 1 : 0,
        command.payload.paused ? command.payload.expectedReviewAt : null,
        now,
        pilot.id,
        command.eventId,
      ),
    ];
    if (command.payload.plannedOperationId) {
      statements.push(
        this.env.DB.prepare(
          `UPDATE planned_operational_constraints
              SET status = ?1, version = version + 1, updated_at = ?2,
                  activated_at = CASE WHEN ?1 = 'ACTIVE' THEN ?2 ELSE activated_at END,
                  cleared_at = CASE WHEN ?1 = 'CLEARED' THEN ?2 ELSE cleared_at END
            WHERE id = ?3 AND operation_day_id = ?4`,
        ).bind(
          command.payload.paused ? "ACTIVE" : "CLEARED",
          now,
          command.payload.plannedOperationId,
          command.eventId,
        ),
      );
    }
    if (!command.payload.paused) {
      statements.push(
        this.env.DB.prepare(
          `UPDATE recurring_operational_rules
              SET progress_value = 0, last_reset_at = ?1, updated_at = ?1,
                  version = version + 1
            WHERE operation_day_id = ?2 AND scope_type = 'PILOT' AND scope_id = ?3
              AND operation_kind = 'PAUSE' AND status = 'ACTIVE'`,
        ).bind(now, command.eventId, pilot.id),
      );
    }
    return {
      aggregateType: "PILOT",
      aggregateId: pilot.id,
      eventType: command.payload.paused ? "PILOT_PAUSE_STARTED" : "PILOT_PAUSE_ENDED",
      auditPayload: {
        operationalCode: pilot.operational_code,
        paused: command.payload.paused,
        reason: command.payload.reason,
        expectedReviewAt: command.payload.expectedReviewAt,
        plannedOperationId: command.payload.plannedOperationId,
      },
      statements,
    };
  }

  async preparePilotUpsert(
    command: PilotUpsertCommand,
    now: string,
  ): Promise<FleetMutationPlan | Response> {
    const duplicateCode = await this.env.DB.prepare(
      "SELECT id FROM pilots WHERE operation_day_id = ?1 AND operational_code = ?2 AND id <> ?3",
    )
      .bind(command.eventId, command.payload.operationalCode, command.payload.pilotId)
      .first<{ id: string }>();
    if (duplicateCode) {
      return json(
        {
          error: {
            code: "PILOT_CODE_EXISTS",
            message: "Operatives Pilotenkürzel ist vergeben.",
          },
        },
        { status: 409 },
      );
    }
    return {
      aggregateType: "PILOT",
      aggregateId: command.payload.pilotId,
      eventType: "PILOT_CONFIGURATION_CHANGED",
      auditPayload: {
        operationalCode: command.payload.operationalCode,
        operationalNote: command.payload.operationalNote,
        active: command.payload.active,
        reason: command.payload.reason,
      },
      statements: [
        this.env.DB.prepare(
          `INSERT INTO pilots
            (id, operation_day_id, operational_code, operational_note, active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET operational_code = excluded.operational_code,
           operational_note = excluded.operational_note, active = excluded.active,
           updated_at = excluded.updated_at`,
        ).bind(
          command.payload.pilotId,
          command.eventId,
          command.payload.operationalCode,
          command.payload.operationalNote,
          command.payload.active ? 1 : 0,
          now,
        ),
      ],
    };
  }

  private buildAircraftStateStatements(
    command: AircraftStateCommand,
    aircraft: StoredFleetAircraft,
    nextState: AircraftOperationalState,
    now: string,
  ): D1PreparedStatement[] {
    const resetCounter =
      aircraft.operational_state === "REFUELING" && nextState === "AVAILABLE"
        ? 0
        : aircraft.rotations_since_refuel;
    const statements = [
      this.env.DB.prepare(
        `UPDATE aircraft SET operational_state = ?1, operational_state_changed_at = ?4,
                rotations_since_refuel = ?2,
                refuel_planned = CASE WHEN ?1 = 'REFUELING' THEN 0 ELSE refuel_planned END,
                operational_interrupted = ?3, version = version + 1,
                updated_at = ?4 WHERE id = ?5`,
      ).bind(
        nextState,
        resetCounter,
        command.payload.state === "INTERRUPTED" ? 1 : 0,
        now,
        aircraft.id,
      ),
    ];
    if (nextState === "AVAILABLE") {
      statements.push(
        this.env.DB.prepare(
          `UPDATE operational_blocks SET status = 'CLEARED', cleared_at = ?1
            WHERE operation_day_id = ?2 AND scope_type = 'AIRCRAFT' AND scope_id = ?3
              AND status = 'ACTIVE'`,
        ).bind(now, command.eventId, aircraft.id),
      );
      if (command.payload.plannedOperationId) {
        statements.push(
          this.env.DB.prepare(
            `UPDATE planned_operational_constraints
                SET status = 'CLEARED', cleared_at = ?1, updated_at = ?1,
                    version = version + 1
              WHERE id = ?2 AND operation_day_id = ?3`,
          ).bind(now, command.payload.plannedOperationId, command.eventId),
        );
      }
      const completedKind = completedOperationalKind(aircraft.operational_state);
      if (completedKind) {
        statements.push(
          this.env.DB.prepare(
            `UPDATE recurring_operational_rules
                SET progress_value = 0, last_reset_at = ?1, updated_at = ?1,
                    version = version + 1
              WHERE operation_day_id = ?2 AND scope_type = 'AIRCRAFT' AND scope_id = ?3
                AND operation_kind = ?4 AND status = 'ACTIVE'`,
          ).bind(now, command.eventId, aircraft.id, completedKind),
        );
      }
      return statements;
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_blocks
          (id, operation_day_id, scope_type, scope_id, block_type, status, reason,
           started_at, expected_review_at, device_id, planned_operation_id)
         VALUES (?1, ?2, 'AIRCRAFT', ?3, ?4, 'ACTIVE', ?5, ?6, ?7, ?8, ?9)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        aircraft.id,
        operationalBlockType(nextState),
        command.payload.reason,
        now,
        command.payload.expectedReviewAt,
        command.deviceId,
        command.payload.plannedOperationId ?? null,
      ),
    );
    if (command.payload.plannedOperationId) {
      statements.push(
        this.env.DB.prepare(
          `UPDATE planned_operational_constraints
              SET status = 'ACTIVE', activated_at = ?1, updated_at = ?1,
                  version = version + 1
            WHERE id = ?2 AND operation_day_id = ?3`,
        ).bind(now, command.payload.plannedOperationId, command.eventId),
      );
    }
    return statements;
  }

  async prepareAircraftCommand(
    command: AircraftFleetCommand,
    now: string,
  ): Promise<FleetMutationPlan | Response> {
    const aircraft = await this.env.DB.prepare(
      `SELECT id, operational_state, rotations_since_refuel, refuel_planned, operational_interrupted
         FROM aircraft WHERE id = ?1 AND EXISTS
           (SELECT 1 FROM resource_group_memberships m
             WHERE m.aircraft_id = aircraft.id AND m.operation_day_id = ?2)`,
    )
      .bind(command.payload.aircraftId, command.eventId)
      .first<StoredFleetAircraft>();
    if (!aircraft) {
      return json(
        { error: { code: "AIRCRAFT_NOT_FOUND", message: "Flugzeug nicht gefunden." } },
        { status: 404 },
      );
    }
    if (command.type === "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD") {
      return {
        aggregateType: "AIRCRAFT",
        aggregateId: aircraft.id,
        eventType: "AIRCRAFT_REFUEL_THRESHOLD_CONFIGURED",
        auditPayload: {
          reminderThreshold: command.payload.reminderThreshold,
          reason: command.payload.reason,
          informationalOnly: true,
        },
        statements: [
          this.env.DB.prepare(
            "UPDATE aircraft SET refuel_reminder_threshold = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
          ).bind(command.payload.reminderThreshold, now, aircraft.id),
        ],
      };
    }
    if (command.type === "SCHEDULE_AIRCRAFT_REFUEL") {
      return {
        aggregateType: "AIRCRAFT",
        aggregateId: aircraft.id,
        eventType: command.payload.planned
          ? "AIRCRAFT_REFUEL_PLANNED"
          : "AIRCRAFT_REFUEL_PLAN_CLEARED",
        auditPayload: { planned: command.payload.planned, reason: command.payload.reason },
        statements: [
          this.env.DB.prepare(
            "UPDATE aircraft SET refuel_planned = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
          ).bind(command.payload.planned ? 1 : 0, now, aircraft.id),
        ],
      };
    }
    if (
      !(["AVAILABLE", "REFUELING", "PAUSED", "INACTIVE"] as const).includes(
        aircraft.operational_state as "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE",
      )
    ) {
      return json(
        {
          error: {
            code: "AIRCRAFT_LIFECYCLE_ACTIVE",
            message:
              "Der operative Umlaufzustand darf nicht über die Flottensteuerung geändert werden.",
          },
        },
        { status: 409 },
      );
    }
    let nextState: AircraftOperationalState;
    try {
      nextState = transitionAircraft(
        aircraft.operational_state,
        command.payload.state === "INTERRUPTED" ? "INACTIVE" : command.payload.state,
      );
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    return {
      aggregateType: "AIRCRAFT",
      aggregateId: aircraft.id,
      eventType: "AIRCRAFT_OPERATIONAL_STATE_CHANGED",
      auditPayload: {
        from: aircraft.operational_state,
        to: command.payload.state,
        reason: command.payload.reason,
        expectedReviewAt: command.payload.expectedReviewAt,
        plannedOperationId: command.payload.plannedOperationId,
        informationalOnly: true,
      },
      statements: this.buildAircraftStateStatements(command, aircraft, nextState, now),
    };
  }
}
