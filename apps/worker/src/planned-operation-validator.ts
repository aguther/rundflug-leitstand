import type { CommandEnvelope } from "@rundflug/contracts";
import type { PlannedOperationKind, PlannedOperationScope } from "./planned-operation-audit-reason";
import type { Env } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export type PlannedOperationCommand = Extract<
  CommandEnvelope,
  {
    type: "UPSERT_PLANNED_OPERATION" | "CANCEL_PLANNED_OPERATION" | "SET_PLANNED_SLOWDOWN_ACTIVE";
  }
>;
export type UpsertPlannedOperationCommand = Extract<
  PlannedOperationCommand,
  { type: "UPSERT_PLANNED_OPERATION" }
>;
export type CancelPlannedOperationCommand = Extract<
  PlannedOperationCommand,
  { type: "CANCEL_PLANNED_OPERATION" }
>;
export type SetPlannedSlowdownCommand = Extract<
  PlannedOperationCommand,
  { type: "SET_PLANNED_SLOWDOWN_ACTIVE" }
>;

export interface ExistingPlannedOperation {
  id: string;
  version: number;
  status: "PLANNED" | "ACTIVE" | "CLEARED" | "CANCELED";
  constraint_kind: PlannedOperationKind;
  scope_type: PlannedOperationScope;
  effect_mode: "BLOCKING" | "SLOWDOWN";
  duration_multiplier_percent: number | null;
  recurring_rule_id: string | null;
}

interface RotationScopeRow {
  id: string;
  status: string;
  aircraft_id: string | null;
  pilot_id: string | null;
  resource_group_id: string;
}

export class PlannedOperationValidator {
  constructor(private readonly env: Env) {}

  private errorResponse(
    code: string,
    message: string,
    status: number,
    currentVersion?: number,
  ): Response {
    return json(
      {
        error: {
          code,
          message,
          ...(currentVersion === undefined ? {} : { currentVersion }),
        },
      },
      { status },
    );
  }

  async findExisting(command: PlannedOperationCommand) {
    return this.env.DB.prepare(
      `SELECT id, version, status, constraint_kind, scope_type, effect_mode,
              duration_multiplier_percent, recurring_rule_id
         FROM planned_operational_constraints
        WHERE id = ?1 AND operation_day_id = ?2`,
    )
      .bind(command.payload.planId, command.eventId)
      .first<ExistingPlannedOperation>();
  }

  private async plannedScopeExists(command: UpsertPlannedOperationCommand): Promise<boolean> {
    const { scopeId, scopeType } = command.payload;
    if (scopeType === "EVENT") return scopeId === command.eventId;
    if (scopeType === "RESOURCE_GROUP") {
      return Boolean(
        await this.env.DB.prepare(
          "SELECT id FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2",
        )
          .bind(scopeId, command.eventId)
          .first(),
      );
    }
    if (scopeType === "AIRCRAFT") {
      return Boolean(
        await this.env.DB.prepare(
          `SELECT a.id FROM aircraft a
             JOIN resource_group_memberships m ON m.aircraft_id = a.id
            WHERE a.id = ?1 AND m.operation_day_id = ?2 AND m.active_until IS NULL`,
        )
          .bind(scopeId, command.eventId)
          .first(),
      );
    }
    return Boolean(
      await this.env.DB.prepare("SELECT id FROM pilots WHERE id = ?1 AND operation_day_id = ?2")
        .bind(scopeId, command.eventId)
        .first(),
    );
  }

  private rotationMatchesScope(
    command: UpsertPlannedOperationCommand,
    rotation: RotationScopeRow,
  ): boolean {
    const { scopeId, scopeType } = command.payload;
    if (scopeType === "EVENT") return true;
    if (scopeType === "RESOURCE_GROUP") return rotation.resource_group_id === scopeId;
    if (scopeType === "AIRCRAFT") return rotation.aircraft_id === scopeId;
    return rotation.pilot_id === scopeId;
  }

  private async validateRotationScope(
    command: UpsertPlannedOperationCommand,
  ): Promise<Response | null> {
    if (!command.payload.afterRotationId) return null;
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.aircraft_id, r.pilot_id, fg.resource_group_id
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2`,
    )
      .bind(command.payload.afterRotationId, command.eventId)
      .first<RotationScopeRow>();
    if (!rotation) {
      return this.errorResponse(
        "PLANNED_OPERATION_ROTATION_NOT_FOUND",
        "Der Bezugsumlauf des Planeintrags wurde nicht gefunden.",
        404,
      );
    }
    if (
      !["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status) ||
      !this.rotationMatchesScope(command, rotation)
    ) {
      return this.errorResponse(
        "PLANNED_OPERATION_ROTATION_SCOPE_MISMATCH",
        "Der Bezugsumlauf ist nicht der aktuelle Umlauf des gewählten Ziels.",
        409,
      );
    }
    return null;
  }

  private async validateUpsert(
    command: UpsertPlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
  ): Promise<Response | null> {
    const expectedVersion = command.payload.planExpectedVersion;
    if (
      (expectedVersion === null && existing) ||
      (expectedVersion !== null && (!existing || existing.version !== expectedVersion))
    ) {
      return this.errorResponse(
        "PLANNED_OPERATION_VERSION_CONFLICT",
        "Der Betriebsplan wurde inzwischen geändert.",
        409,
        existing?.version,
      );
    }
    if (existing && existing.status !== "PLANNED") {
      return this.errorResponse(
        "PLANNED_OPERATION_NOT_EDITABLE",
        "Nur noch nicht gestartete Planeinträge können bearbeitet werden.",
        409,
      );
    }
    if (existing?.recurring_rule_id) {
      return this.errorResponse(
        "RECURRING_OCCURRENCE_NOT_EDITABLE",
        "Ein automatisch erzeugtes Vorkommen wird über seine Regel gepflegt oder einmalig übersprungen.",
        409,
      );
    }
    if (!(await this.plannedScopeExists(command))) {
      return this.errorResponse(
        "PLANNED_OPERATION_SCOPE_NOT_FOUND",
        "Das Ziel des Planeintrags wurde nicht gefunden.",
        404,
      );
    }
    return this.validateRotationScope(command);
  }

  private validateCancel(
    command: CancelPlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
  ): Response | null {
    if (!existing) {
      return this.errorResponse("PLANNED_OPERATION_NOT_FOUND", "Planeintrag nicht gefunden.", 404);
    }
    if (existing.version !== command.payload.planExpectedVersion) {
      return this.errorResponse(
        "PLANNED_OPERATION_VERSION_CONFLICT",
        "Der Betriebsplan wurde inzwischen geändert.",
        409,
        existing.version,
      );
    }
    if (existing.status !== "PLANNED") {
      return this.errorResponse(
        "PLANNED_OPERATION_NOT_CANCELABLE",
        "Nur noch nicht gestartete Planeinträge können abgesagt werden.",
        409,
      );
    }
    return null;
  }

  private validateSlowdown(
    command: SetPlannedSlowdownCommand,
    existing: ExistingPlannedOperation | null,
  ): Response | null {
    if (!existing) {
      return this.errorResponse("PLANNED_OPERATION_NOT_FOUND", "Planeintrag nicht gefunden.", 404);
    }
    if (existing.version !== command.payload.planExpectedVersion) {
      return this.errorResponse(
        "PLANNED_OPERATION_VERSION_CONFLICT",
        "Der Betriebsplan wurde inzwischen geändert.",
        409,
        existing.version,
      );
    }
    if (existing.effect_mode !== "SLOWDOWN") {
      return this.errorResponse(
        "PLANNED_OPERATION_EFFECT_MISMATCH",
        "Nur ein verzögerter Betrieb wird ohne Ressourcenstopp bestätigt.",
        409,
      );
    }
    const expectedStatus = command.payload.active ? "PLANNED" : "ACTIVE";
    if (existing.status !== expectedStatus) {
      return this.errorResponse(
        "PLANNED_OPERATION_STATUS_MISMATCH",
        "Der Planeintrag ist für diese Bestätigung nicht im passenden Zustand.",
        409,
      );
    }
    return null;
  }

  validateCommand(
    command: PlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
  ): Promise<Response | null> | Response | null {
    if (command.type === "UPSERT_PLANNED_OPERATION") {
      return this.validateUpsert(command, existing);
    }
    if (command.type === "CANCEL_PLANNED_OPERATION") {
      return this.validateCancel(command, existing);
    }
    return this.validateSlowdown(command, existing);
  }
}
