import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

type AircraftUpsertCommand = Extract<CommandEnvelope, { type: "UPSERT_AIRCRAFT" }>;
type ResourceGroupUpsertCommand = Extract<CommandEnvelope, { type: "UPSERT_RESOURCE_GROUP" }>;
type AircraftAssignmentCommand = Extract<
  CommandEnvelope,
  { type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP" }
>;

interface ResourceMutationPlan {
  eventType: "RESOURCE_GROUP_UPSERTED" | "AIRCRAFT_UPSERTED" | "AIRCRAFT_RESOURCE_GROUP_ASSIGNED";
  aggregate: { type: "RESOURCE_GROUP" | "AIRCRAFT"; id: string };
  auditPayload: Record<string, unknown>;
  mutations: D1PreparedStatement[];
}

interface ActiveResourceGroupMembership {
  id: string;
  aircraft_id: string;
  resource_group_id: string;
}

function resourceGroupReferenceConflict(
  duplicateName: boolean,
  duplicateShortCode: boolean,
): Response {
  if (duplicateName) {
    return json(
      {
        error: {
          code: "RESOURCE_GROUP_NAME_EXISTS",
          message: "Ressourcengruppen-Bezeichnung ist bereits vergeben.",
        },
      },
      { status: 409 },
    );
  }
  if (duplicateShortCode) {
    return json(
      {
        error: {
          code: "RESOURCE_GROUP_SHORT_CODE_EXISTS",
          message: "Ressourcengruppen-Kurzzeichen ist bereits vergeben.",
        },
      },
      { status: 409 },
    );
  }
  return json(
    {
      error: {
        code: "GATE_NOT_AVAILABLE",
        message: "Das ausgewählte Gate ist nicht aktiv verfügbar.",
      },
    },
    { status: 409 },
  );
}
export class MasterDataResourceService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleResourceAndAircraftMasterData(
    command: Extract<
      CommandEnvelope,
      {
        type: "UPSERT_RESOURCE_GROUP" | "UPSERT_AIRCRAFT" | "ASSIGN_AIRCRAFT_RESOURCE_GROUP";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    let plan: ResourceMutationPlan | Response;
    if (command.type === "UPSERT_RESOURCE_GROUP") {
      plan = await this.prepareResourceGroupUpsert(command, now);
    } else if (command.type === "UPSERT_AIRCRAFT") {
      plan = await this.prepareAircraftUpsert(command, now);
    } else {
      plan = await this.prepareAircraftAssignment(command, now);
    }
    if (plan instanceof Response) return plan;
    const { eventType, aggregate, auditPayload, mutations } = plan;

    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate,
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      ...mutations,
      this.env.DB.prepare(
        `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        aggregate.type,
        aggregate.id,
        nextVersion,
        JSON.stringify(auditPayload),
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
    ]);
    this.broadcast(result);
    return json(result);
  }

  private async prepareResourceGroupUpsert(
    command: ResourceGroupUpsertCommand,
    now: string,
  ): Promise<ResourceMutationPlan | Response> {
    const mutations: D1PreparedStatement[] = [];
    const [gate, duplicateName, duplicateShortCode] = await Promise.all([
      this.env.DB.prepare(
        "SELECT id FROM gates WHERE id = ?1 AND operation_day_id = ?2 AND active = 1",
      )
        .bind(command.payload.gateId, command.eventId)
        .first<{ id: string }>(),
      this.env.DB.prepare(
        "SELECT id FROM resource_groups WHERE operation_day_id = ?1 AND name = ?2 AND id <> ?3",
      )
        .bind(command.eventId, command.payload.name, command.payload.resourceGroupId)
        .first<{ id: string }>(),
      this.env.DB.prepare(
        "SELECT id FROM resource_groups WHERE operation_day_id = ?1 AND short_code = ?2 AND id <> ?3",
      )
        .bind(command.eventId, command.payload.shortCode, command.payload.resourceGroupId)
        .first<{ id: string }>(),
    ]);
    if (!gate || duplicateName || duplicateShortCode) {
      return resourceGroupReferenceConflict(Boolean(duplicateName), Boolean(duplicateShortCode));
    }
    const desiredAircraftIds = [...new Set(command.payload.aircraftIds ?? [])];
    const [availableAircraft, activeMemberships, activeRotations] = await Promise.all([
      this.env.DB.prepare("SELECT id FROM aircraft").all<{ id: string }>(),
      this.env.DB.prepare(
        `SELECT id, aircraft_id, resource_group_id FROM resource_group_memberships
              WHERE operation_day_id = ?1 AND active_until IS NULL`,
      )
        .bind(command.eventId)
        .all<{ id: string; aircraft_id: string; resource_group_id: string }>(),
      this.env.DB.prepare(
        `SELECT aircraft_id FROM rotations WHERE operation_day_id = ?1
              AND aircraft_id IS NOT NULL AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')`,
      )
        .bind(command.eventId)
        .all<{ aircraft_id: string }>(),
    ]);
    const knownAircraftIds = new Set(availableAircraft.results.map((aircraft) => aircraft.id));
    if (desiredAircraftIds.some((aircraftId) => !knownAircraftIds.has(aircraftId))) {
      return json(
        {
          error: {
            code: "RESOURCE_GROUP_AIRCRAFT_INVALID",
            message: "Mindestens ein ausgewähltes Flugzeug ist nicht mehr verfügbar.",
          },
        },
        { status: 409 },
      );
    }
    const desiredAircraftIdSet = new Set(desiredAircraftIds);
    const changedAircraftIds = new Set(
      activeMemberships.results
        .filter(
          (membership) =>
            (membership.resource_group_id === command.payload.resourceGroupId &&
              !desiredAircraftIdSet.has(membership.aircraft_id)) ||
            (desiredAircraftIdSet.has(membership.aircraft_id) &&
              membership.resource_group_id !== command.payload.resourceGroupId),
        )
        .map((membership) => membership.aircraft_id),
    );
    const activeAircraftIds = new Set(
      activeRotations.results.map((rotation) => rotation.aircraft_id),
    );
    if ([...changedAircraftIds].some((aircraftId) => activeAircraftIds.has(aircraftId))) {
      return json(
        {
          error: {
            code: "AIRCRAFT_LIFECYCLE_ACTIVE",
            message: "Flugzeugzuordnungen sind während eines aktiven Umlaufs gesperrt.",
          },
        },
        { status: 409 },
      );
    }
    const eventType = "RESOURCE_GROUP_UPSERTED";
    const aggregate: ResourceMutationPlan["aggregate"] = {
      type: "RESOURCE_GROUP",
      id: command.payload.resourceGroupId,
    };
    const auditPayload = {
      name: command.payload.name,
      shortCode: command.payload.shortCode,
      gateId: command.payload.gateId,
      referenceCapacity: command.payload.referenceCapacity,
      compatibleAircraftTypes: command.payload.compatibleAircraftTypes,
      automaticPrecallEnabled: command.payload.automaticPrecallEnabled,
      aircraftIds: desiredAircraftIds,
      reason: command.payload.reason,
    };
    mutations.push(
      this.env.DB.prepare(
        `INSERT INTO resource_groups
              (id, operation_day_id, name, short_code, status, gate_id, reference_capacity,
               compatible_aircraft_types_json, automatic_precall_enabled,
               version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'ACTIVE', ?5, ?6, ?7, ?8, 0, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_code = excluded.short_code,
              gate_id = excluded.gate_id,
              reference_capacity = excluded.reference_capacity,
              compatible_aircraft_types_json = excluded.compatible_aircraft_types_json,
              automatic_precall_enabled = excluded.automatic_precall_enabled,
              version = resource_groups.version + 1, updated_at = excluded.updated_at
             WHERE resource_groups.operation_day_id = excluded.operation_day_id`,
      ).bind(
        command.payload.resourceGroupId,
        command.eventId,
        command.payload.name,
        command.payload.shortCode,
        command.payload.gateId,
        command.payload.referenceCapacity,
        JSON.stringify([...new Set(command.payload.compatibleAircraftTypes)]),
        command.payload.automaticPrecallEnabled ? 1 : 0,
        now,
      ),
      ...this.buildResourceGroupMembershipMutations(
        command,
        now,
        activeMemberships.results,
        desiredAircraftIds,
        desiredAircraftIdSet,
      ),
    );
    return { eventType, aggregate, auditPayload, mutations };
  }

  private async prepareAircraftUpsert(
    command: AircraftUpsertCommand,
    now: string,
  ): Promise<ResourceMutationPlan | Response> {
    const [duplicate, activeRotation] = await Promise.all([
      this.env.DB.prepare("SELECT id FROM aircraft WHERE registration = ?1 AND id <> ?2")
        .bind(command.payload.registration, command.payload.aircraftId)
        .first<{ id: string }>(),
      this.env.DB.prepare(
        `SELECT id FROM rotations WHERE aircraft_id = ?1
            AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED') LIMIT 1`,
      )
        .bind(command.payload.aircraftId)
        .first<{ id: string }>(),
    ]);
    if (duplicate || activeRotation) {
      return json(
        {
          error: {
            code: duplicate ? "AIRCRAFT_REGISTRATION_EXISTS" : "AIRCRAFT_LIFECYCLE_ACTIVE",
            message: duplicate
              ? "Kennzeichen ist bereits vergeben."
              : "Flugzeugstammdaten sind während eines aktiven Umlaufs gesperrt.",
          },
        },
        { status: 409 },
      );
    }
    return {
      eventType: "AIRCRAFT_UPSERTED",
      aggregate: { type: "AIRCRAFT", id: command.payload.aircraftId },
      auditPayload: {
        registration: command.payload.registration,
        aircraftType: command.payload.aircraftType,
        passengerSeats: command.payload.passengerSeats,
        maximumPassengerPayloadKg: command.payload.maximumPassengerPayloadKg,
        reason: command.payload.reason,
      },
      mutations: [
        this.env.DB.prepare(
          `INSERT INTO aircraft
              (id, registration, aircraft_type, passenger_seats, maximum_passenger_payload_kg,
               operational_state_changed_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
             ON CONFLICT(id) DO UPDATE SET registration = excluded.registration,
              aircraft_type = excluded.aircraft_type, passenger_seats = excluded.passenger_seats,
              maximum_passenger_payload_kg = excluded.maximum_passenger_payload_kg,
              version = aircraft.version + 1, updated_at = excluded.updated_at`,
        ).bind(
          command.payload.aircraftId,
          command.payload.registration,
          command.payload.aircraftType,
          command.payload.passengerSeats,
          command.payload.maximumPassengerPayloadKg,
          now,
        ),
      ],
    };
  }

  private buildResourceGroupMembershipMutations(
    command: ResourceGroupUpsertCommand,
    now: string,
    activeMemberships: ActiveResourceGroupMembership[],
    desiredAircraftIds: string[],
    desiredAircraftIdSet: Set<string>,
  ): D1PreparedStatement[] {
    if (!command.payload.aircraftIds) return [];
    const mutations: D1PreparedStatement[] = [];
    for (const membership of activeMemberships) {
      if (
        membership.resource_group_id === command.payload.resourceGroupId &&
        !desiredAircraftIdSet.has(membership.aircraft_id)
      ) {
        mutations.push(
          this.env.DB.prepare(
            "UPDATE resource_group_memberships SET active_until = ?1 WHERE id = ?2 AND active_until IS NULL",
          ).bind(now, membership.id),
        );
      }
    }
    for (const aircraftId of desiredAircraftIds) {
      const activeMembership = activeMemberships.find(
        (membership) => membership.aircraft_id === aircraftId,
      );
      if (activeMembership?.resource_group_id === command.payload.resourceGroupId) continue;
      if (activeMembership) {
        mutations.push(
          this.env.DB.prepare(
            "UPDATE resource_group_memberships SET active_until = ?1 WHERE id = ?2 AND active_until IS NULL",
          ).bind(now, activeMembership.id),
        );
      }
      mutations.push(
        this.env.DB.prepare(
          `INSERT INTO resource_group_memberships
              (id, operation_day_id, resource_group_id, aircraft_id, active_from, active_until,
               created_at, change_reason, changed_by_device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          command.eventId,
          command.payload.resourceGroupId,
          aircraftId,
          now,
          command.payload.reason,
          command.deviceId,
        ),
      );
    }
    return mutations;
  }

  private async prepareAircraftAssignment(
    command: AircraftAssignmentCommand,
    now: string,
  ): Promise<ResourceMutationPlan | Response> {
    const [aircraft, target, activeMembership, activeRotation] = await Promise.all([
      this.env.DB.prepare("SELECT id, aircraft_type FROM aircraft WHERE id = ?1")
        .bind(command.payload.aircraftId)
        .first<{ id: string; aircraft_type: string }>(),
      this.env.DB.prepare(
        `SELECT id, compatible_aircraft_types_json FROM resource_groups
            WHERE id = ?1 AND operation_day_id = ?2 AND status <> 'ENDED'`,
      )
        .bind(command.payload.resourceGroupId, command.eventId)
        .first<{ id: string; compatible_aircraft_types_json: string }>(),
      this.env.DB.prepare(
        `SELECT id, resource_group_id, active_from FROM resource_group_memberships
            WHERE operation_day_id = ?1 AND aircraft_id = ?2 AND active_until IS NULL`,
      )
        .bind(command.eventId, command.payload.aircraftId)
        .first<{ id: string; resource_group_id: string; active_from: string }>(),
      this.env.DB.prepare(
        `SELECT id FROM rotations WHERE operation_day_id = ?1 AND aircraft_id = ?2
            AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED') LIMIT 1`,
      )
        .bind(command.eventId, command.payload.aircraftId)
        .first<{ id: string }>(),
    ]);
    if (!aircraft || !target) {
      return json(
        {
          error: {
            code: "ASSIGNMENT_REFERENCE_INVALID",
            message: "Flugzeug oder Ressourcengruppe fehlt.",
          },
        },
        { status: 404 },
      );
    }
    if (activeRotation) {
      return json(
        {
          error: {
            code: "AIRCRAFT_LIFECYCLE_ACTIVE",
            message: "Zuordnung ist während eines aktiven Umlaufs gesperrt.",
          },
        },
        { status: 409 },
      );
    }
    if (activeMembership?.resource_group_id === target.id) {
      return json(
        {
          error: {
            code: "ASSIGNMENT_UNCHANGED",
            message: "Flugzeug ist bereits dieser Ressourcengruppe zugeordnet.",
          },
        },
        { status: 409 },
      );
    }
    if (
      activeMembership &&
      Date.parse(command.payload.effectiveAt) <= Date.parse(activeMembership.active_from)
    ) {
      return json(
        {
          error: {
            code: "ASSIGNMENT_TIME_INVALID",
            message: "Wirksamkeit muss nach Beginn der bisherigen Zuordnung liegen.",
          },
        },
        { status: 409 },
      );
    }
    const compatibleTypes = JSON.parse(target.compatible_aircraft_types_json) as string[];
    if (compatibleTypes.length > 0 && !compatibleTypes.includes(aircraft.aircraft_type)) {
      return json(
        {
          error: {
            code: "AIRCRAFT_TYPE_INCOMPATIBLE",
            message: "Flugzeugtyp ist für diese Ressourcengruppe nicht freigegeben.",
          },
        },
        { status: 409 },
      );
    }
    const mutations: D1PreparedStatement[] = [];
    if (activeMembership) {
      mutations.push(
        this.env.DB.prepare(
          `UPDATE resource_group_memberships SET active_until = ?1
              WHERE id = ?2 AND active_until IS NULL`,
        ).bind(command.payload.effectiveAt, activeMembership.id),
      );
    }
    mutations.push(
      this.env.DB.prepare(
        `INSERT INTO resource_group_memberships
            (id, operation_day_id, resource_group_id, aircraft_id, active_from, active_until,
             created_at, change_reason, changed_by_device_id)
           VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        target.id,
        aircraft.id,
        command.payload.effectiveAt,
        now,
        command.payload.reason,
        command.deviceId,
      ),
    );
    return {
      eventType: "AIRCRAFT_RESOURCE_GROUP_ASSIGNED",
      aggregate: { type: "AIRCRAFT", id: aircraft.id },
      auditPayload: {
        fromResourceGroupId: activeMembership?.resource_group_id ?? null,
        toResourceGroupId: target.id,
        effectiveAt: command.payload.effectiveAt,
        reason: command.payload.reason,
      },
      mutations,
    };
  }
}
