import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";

type DeleteMasterDataCommand = Extract<CommandEnvelope, { type: "DELETE_MASTER_DATA" }>;

export interface MasterDataDeletionPlan {
  aggregate: NonNullable<CommandResult["aggregate"]>;
  blockers: string[];
  deletion: D1PreparedStatement;
  eventType:
    | "GATE_DELETED"
    | "RESOURCE_GROUP_DELETED"
    | "PRODUCT_DELETED"
    | "PILOT_DELETED"
    | "AIRCRAFT_DELETED"
    | "AIRCRAFT_RESOURCE_GROUP_ASSIGNMENT_DELETED";
  label: string;
  removedMembershipCount: number;
}

interface MasterDataDeletionError {
  code: string;
  message: string;
  status: 404;
}

export type MasterDataDeletionResolution =
  | { error: MasterDataDeletionError; plan?: never }
  | { error?: never; plan: MasterDataDeletionPlan };

const missing = (code: string, message: string): MasterDataDeletionResolution => ({
  error: { code, message, status: 404 },
});

async function resolveGateDeletion(
  database: D1Database,
  eventId: string,
  entityId: string,
): Promise<MasterDataDeletionResolution> {
  const [entity, groups, products, rotations] = await Promise.all([
    database
      .prepare("SELECT label FROM gates WHERE id = ?1 AND operation_day_id = ?2")
      .bind(entityId, eventId)
      .first<{ label: string }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM resource_groups WHERE gate_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM products WHERE gate_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM rotations WHERE gate_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
  ]);
  if (!entity) return missing("GATE_NOT_FOUND", "Gate nicht gefunden.");
  const blockers: string[] = [];
  if ((groups?.count ?? 0) > 0) blockers.push(`${groups?.count} Ressourcengruppe(n)`);
  if ((products?.count ?? 0) > 0) blockers.push(`${products?.count} Produkt(e)`);
  if ((rotations?.count ?? 0) > 0) blockers.push(`${rotations?.count} Umlauf/Umläufe`);
  return {
    plan: {
      aggregate: { type: "GATE", id: entityId },
      blockers,
      deletion: database
        .prepare("DELETE FROM gates WHERE id = ?1 AND operation_day_id = ?2")
        .bind(entityId, eventId),
      eventType: "GATE_DELETED",
      label: entity.label,
      removedMembershipCount: 0,
    },
  };
}

async function resolveResourceGroupDeletion(
  database: D1Database,
  eventId: string,
  entityId: string,
): Promise<MasterDataDeletionResolution> {
  const [entity, products, memberships, flightGroups] = await Promise.all([
    database
      .prepare("SELECT name FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2")
      .bind(entityId, eventId)
      .first<{ name: string }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM products WHERE resource_group_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM resource_group_memberships WHERE resource_group_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM flight_groups WHERE resource_group_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
  ]);
  if (!entity) {
    return missing("RESOURCE_GROUP_NOT_FOUND", "Ressourcengruppe nicht gefunden.");
  }
  const blockers: string[] = [];
  if ((products?.count ?? 0) > 0) blockers.push(`${products?.count} Produkt(e)`);
  if ((memberships?.count ?? 0) > 0) {
    blockers.push(`${memberships?.count} Flugzeugzuordnung(en)`);
  }
  if ((flightGroups?.count ?? 0) > 0) blockers.push(`${flightGroups?.count} Fluggruppe(n)`);
  return {
    plan: {
      aggregate: { type: "RESOURCE_GROUP", id: entityId },
      blockers,
      deletion: database
        .prepare("DELETE FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2")
        .bind(entityId, eventId),
      eventType: "RESOURCE_GROUP_DELETED",
      label: entity.name,
      removedMembershipCount: 0,
    },
  };
}

async function resolveProductDeletion(
  database: D1Database,
  eventId: string,
  entityId: string,
): Promise<MasterDataDeletionResolution> {
  const [entity, ticketGroups] = await Promise.all([
    database
      .prepare("SELECT name FROM products WHERE id = ?1 AND operation_day_id = ?2")
      .bind(entityId, eventId)
      .first<{ name: string }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM ticket_groups WHERE product_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
  ]);
  if (!entity) return missing("PRODUCT_NOT_FOUND", "Produkt nicht gefunden.");
  const blockers = (ticketGroups?.count ?? 0) > 0 ? [`${ticketGroups?.count} Ticketgruppe(n)`] : [];
  return {
    plan: {
      aggregate: { type: "PRODUCT", id: entityId },
      blockers,
      deletion: database
        .prepare("DELETE FROM products WHERE id = ?1 AND operation_day_id = ?2")
        .bind(entityId, eventId),
      eventType: "PRODUCT_DELETED",
      label: entity.name,
      removedMembershipCount: 0,
    },
  };
}

async function resolvePilotDeletion(
  database: D1Database,
  eventId: string,
  entityId: string,
): Promise<MasterDataDeletionResolution> {
  const [entity, rotations, aircraft] = await Promise.all([
    database
      .prepare("SELECT operational_code FROM pilots WHERE id = ?1 AND operation_day_id = ?2")
      .bind(entityId, eventId)
      .first<{ operational_code: string }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM rotations WHERE pilot_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM resource_group_memberships WHERE current_pilot_id = ?1 AND operation_day_id = ?2",
      )
      .bind(entityId, eventId)
      .first<{ count: number }>(),
  ]);
  if (!entity) return missing("PILOT_NOT_FOUND", "Pilotencode nicht gefunden.");
  const blockers: string[] = [];
  if ((rotations?.count ?? 0) > 0) blockers.push(`${rotations?.count} Umlauf/Umläufe`);
  if ((aircraft?.count ?? 0) > 0) blockers.push(`${aircraft?.count} Flugzeugbindung(en)`);
  return {
    plan: {
      aggregate: { type: "PILOT", id: entityId },
      blockers,
      deletion: database
        .prepare("DELETE FROM pilots WHERE id = ?1 AND operation_day_id = ?2")
        .bind(entityId, eventId),
      eventType: "PILOT_DELETED",
      label: entity.operational_code,
      removedMembershipCount: 0,
    },
  };
}

async function resolveAircraftDeletion(
  database: D1Database,
  entityId: string,
): Promise<MasterDataDeletionResolution> {
  const [entity, memberships, rotations] = await Promise.all([
    database
      .prepare("SELECT registration FROM aircraft WHERE id = ?1")
      .bind(entityId)
      .first<{ registration: string }>(),
    database
      .prepare("SELECT COUNT(*) AS count FROM resource_group_memberships WHERE aircraft_id = ?1")
      .bind(entityId)
      .first<{ count: number }>(),
    database
      .prepare("SELECT COUNT(*) AS count FROM rotations WHERE aircraft_id = ?1")
      .bind(entityId)
      .first<{ count: number }>(),
  ]);
  if (!entity) return missing("AIRCRAFT_NOT_FOUND", "Flugzeug nicht gefunden.");
  const blockers: string[] = [];
  if ((memberships?.count ?? 0) > 0) {
    blockers.push(`${memberships?.count} Flugzeugzuordnung(en)`);
  }
  if ((rotations?.count ?? 0) > 0) blockers.push(`${rotations?.count} Umlauf/Umläufe`);
  return {
    plan: {
      aggregate: { type: "AIRCRAFT", id: entityId },
      blockers,
      deletion: database.prepare("DELETE FROM aircraft WHERE id = ?1").bind(entityId),
      eventType: "AIRCRAFT_DELETED",
      label: entity.registration,
      removedMembershipCount: 0,
    },
  };
}

async function resolveAssignmentDeletion(
  database: D1Database,
  eventId: string,
  entityId: string,
): Promise<MasterDataDeletionResolution> {
  const [memberships, rotations] = await Promise.all([
    database
      .prepare(
        `SELECT m.id, a.registration FROM resource_group_memberships m
           JOIN aircraft a ON a.id = m.aircraft_id
          WHERE m.operation_day_id = ?1 AND m.aircraft_id = ?2`,
      )
      .bind(eventId, entityId)
      .all<{ id: string; registration: string }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM rotations WHERE operation_day_id = ?1 AND aircraft_id = ?2",
      )
      .bind(eventId, entityId)
      .first<{ count: number }>(),
  ]);
  if (memberships.results.length === 0) {
    return missing("ASSIGNMENT_NOT_FOUND", "Flugzeugzuordnung nicht gefunden.");
  }
  const blockers = (rotations?.count ?? 0) > 0 ? [`${rotations?.count} Umlauf/Umläufe`] : [];
  return {
    plan: {
      aggregate: { type: "AIRCRAFT", id: entityId },
      blockers,
      deletion: database
        .prepare(
          "DELETE FROM resource_group_memberships WHERE operation_day_id = ?1 AND aircraft_id = ?2",
        )
        .bind(eventId, entityId),
      eventType: "AIRCRAFT_RESOURCE_GROUP_ASSIGNMENT_DELETED",
      label: memberships.results[0]?.registration ?? entityId,
      removedMembershipCount: memberships.results.length,
    },
  };
}

export function resolveMasterDataDeletion(
  database: D1Database,
  command: DeleteMasterDataCommand,
): Promise<MasterDataDeletionResolution> {
  const { entityId, entityType } = command.payload;
  switch (entityType) {
    case "GATE":
      return resolveGateDeletion(database, command.eventId, entityId);
    case "RESOURCE_GROUP":
      return resolveResourceGroupDeletion(database, command.eventId, entityId);
    case "PRODUCT":
      return resolveProductDeletion(database, command.eventId, entityId);
    case "PILOT":
      return resolvePilotDeletion(database, command.eventId, entityId);
    case "AIRCRAFT":
      return resolveAircraftDeletion(database, entityId);
    case "ASSIGNMENT":
      return resolveAssignmentDeletion(database, command.eventId, entityId);
  }
}
