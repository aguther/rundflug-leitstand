import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class PilotAssignmentCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleAircraftPilotAssignment(
    command: Extract<CommandEnvelope, { type: "ASSIGN_AIRCRAFT_PILOT" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const target = await this.env.DB.prepare(
      `SELECT a.id, membership.current_pilot_id
         FROM aircraft a
         JOIN resource_group_memberships membership ON membership.aircraft_id = a.id
        WHERE a.id = ?1 AND membership.operation_day_id = ?2
          AND membership.active_until IS NULL`,
    )
      .bind(command.payload.aircraftId, command.eventId)
      .first<{ id: string; current_pilot_id: string | null }>();
    if (!target) {
      return json(
        { error: { code: "AIRCRAFT_NOT_FOUND", message: "Flugzeug nicht gefunden." } },
        { status: 404 },
      );
    }

    const activeRotation = await this.env.DB.prepare(
      `SELECT id, status, version, pilot_id
         FROM rotations
        WHERE operation_day_id = ?1 AND aircraft_id = ?2
          AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
        ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(command.eventId, target.id)
      .first<{
        id: string;
        status: "CALLED" | "IN_FLIGHT" | "LANDED";
        version: number;
        pilot_id: string | null;
      }>();
    if (activeRotation && activeRotation.status !== "CALLED") {
      return json(
        {
          error: {
            code: "AIRCRAFT_PILOT_CHANGE_BLOCKED",
            message: "Pilotenzuweisung ist ab Offblock bis zum Umlaufabschluss gesperrt.",
          },
        },
        { status: 409 },
      );
    }

    const pilot = await this.env.DB.prepare(
      `SELECT id, operational_code
         FROM pilots
        WHERE id = ?1 AND operation_day_id = ?2 AND active = 1 AND paused = 0`,
    )
      .bind(command.payload.pilotId, command.eventId)
      .first<{ id: string; operational_code: string }>();
    if (!pilot) {
      return json(
        {
          error: {
            code: "PILOT_NOT_AVAILABLE",
            message: "Pilotencode ist nicht aktiv verfügbar.",
          },
        },
        { status: 409 },
      );
    }

    const conflictingRotation = await this.env.DB.prepare(
      `SELECT id, aircraft_id
         FROM rotations
        WHERE operation_day_id = ?1 AND pilot_id = ?2
          AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
          AND id <> COALESCE(?3, '')
        LIMIT 1`,
    )
      .bind(command.eventId, pilot.id, activeRotation?.id ?? null)
      .first<{ id: string; aircraft_id: string | null }>();
    if (conflictingRotation) {
      return json(
        {
          error: {
            code: "PILOT_ASSIGNED_ACTIVE_ROTATION",
            message: "Pilotencode ist an einen aktiven Umlauf gebunden.",
          },
        },
        { status: 409 },
      );
    }

    const assignedElsewhere = await this.env.DB.prepare(
      `SELECT membership.aircraft_id, a.registration,
              EXISTS (
                SELECT 1 FROM rotations active_rotation
                 WHERE active_rotation.operation_day_id = membership.operation_day_id
                   AND active_rotation.aircraft_id = membership.aircraft_id
                   AND active_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
              ) AS has_active_rotation
         FROM resource_group_memberships membership
         JOIN aircraft a ON a.id = membership.aircraft_id
        WHERE membership.operation_day_id = ?1 AND membership.active_until IS NULL
          AND membership.current_pilot_id = ?2 AND membership.aircraft_id <> ?3
        ORDER BY a.registration`,
    )
      .bind(command.eventId, pilot.id, target.id)
      .all<{ aircraft_id: string; registration: string; has_active_rotation: number }>();
    if (assignedElsewhere.results.some((entry) => entry.has_active_rotation === 1)) {
      return json(
        {
          error: {
            code: "PILOT_ASSIGNED_ACTIVE_ROTATION",
            message: "Pilotencode ist an einen aktiven Umlauf gebunden.",
          },
        },
        { status: 409 },
      );
    }
    const firstAssignmentConflict = assignedElsewhere.results[0];
    if (firstAssignmentConflict && !command.payload.reassign) {
      return json(
        {
          error: {
            code: "PILOT_REASSIGN_CONFIRMATION_REQUIRED",
            message: `Pilotencode ist bereits ${firstAssignmentConflict.registration} zugewiesen.`,
            aircraftId: firstAssignmentConflict.aircraft_id,
            aircraftRegistration: firstAssignmentConflict.registration,
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const reassignedAircraftIds = assignedElsewhere.results.map((entry) => entry.aircraft_id);
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "AIRCRAFT_PILOT_CHANGED",
      aggregate: { type: "AIRCRAFT", id: target.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
    ];
    if (reassignedAircraftIds.length > 0) {
      const placeholders = reassignedAircraftIds.map((_, index) => `?${index + 2}`).join(", ");
      statements.push(
        this.env.DB.prepare(
          `UPDATE resource_group_memberships SET current_pilot_id = NULL
            WHERE operation_day_id = ?1 AND aircraft_id IN (${placeholders})
              AND active_until IS NULL AND current_pilot_id = ?${reassignedAircraftIds.length + 2}`,
        ).bind(command.eventId, ...reassignedAircraftIds, pilot.id),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `UPDATE resource_group_memberships SET current_pilot_id = ?1
          WHERE operation_day_id = ?2 AND aircraft_id = ?3 AND active_until IS NULL`,
      ).bind(pilot.id, command.eventId, target.id),
    );
    if (activeRotation) {
      statements.push(
        this.env.DB.prepare(
          `UPDATE rotations SET pilot_id = ?1, version = version + 1, updated_at = ?2
            WHERE id = ?3 AND version = ?4 AND status = 'CALLED'`,
        ).bind(pilot.id, now, activeRotation.id, activeRotation.version),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'AIRCRAFT_PILOT_CHANGED', ?3, ?4, 'AIRCRAFT', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        target.id,
        nextVersion,
        JSON.stringify({
          previousPilotId: target.current_pilot_id,
          pilotId: pilot.id,
          pilotOperationalCode: pilot.operational_code,
          affectedAircraftIds: [target.id, ...reassignedAircraftIds],
          reassignedAircraftIds,
          activeRotationId: activeRotation?.id ?? null,
          previousRotationPilotId: activeRotation?.pilot_id ?? null,
        }),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        command.commandId,
        command.eventId,
        command.deviceId,
        command.type,
        now,
        JSON.stringify(result),
      ),
      this.env.DB.prepare(
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }
}
