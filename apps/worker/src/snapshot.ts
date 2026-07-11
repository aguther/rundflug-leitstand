import type { EventSnapshot } from "@rundflug/contracts";
import type { StoredEventRow } from "./types";

export function rowToSnapshot(row: StoredEventRow): EventSnapshot {
  return {
    eventId: row.id,
    name: row.name,
    eventDate: row.event_date,
    timeZone: row.time_zone,
    status: row.status,
    emergencyMode: row.emergency_mode === 1,
    operationalInterrupted: row.operational_interrupted === 1,
    version: row.version,
    operationalNote: row.operational_note,
    updatedAt: row.updated_at,
  };
}

export function safeErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unbekannter Fehler";
}
