import type { EventSnapshot } from "@rundflug/contracts";
import type { StoredEventRow } from "./types";

export function rowToSnapshot(row: StoredEventRow): EventSnapshot {
  return {
    eventId: row.id,
    name: row.name,
    eventDate: row.event_date,
    aerodrome: row.aerodrome ?? "",
    timeZone: row.time_zone,
    status: row.status,
    archivedAt: row.archived_at ?? null,
    templateSourceId: row.template_source_id ?? null,
    emergencyMode: row.emergency_mode === 1,
    operationalInterrupted: row.operational_interrupted === 1,
    version: row.version,
    operationalNote: row.operational_note,
    saleOpensAt: row.sale_opens_at ?? null,
    operationsEndAt: row.operations_end_at ?? null,
    noShowAfterMinutes: row.no_show_after_minutes ?? 10,
    maxTicketDeferrals: row.max_ticket_deferrals ?? 2,
    notificationLeadMinutes: row.notification_lead_minutes ?? 15,
    automaticPrecallEnabled: row.automatic_precall_enabled !== 0,
    precallLeadMinutes: row.precall_lead_minutes ?? 15,
    maximumGateWaitMinutes: row.max_gate_wait_minutes ?? 20,
    precallMinimumQuality: row.precall_min_quality ?? "CHANGING",
    precallGateCooldownMinutes: row.precall_gate_cooldown_minutes ?? 2,
    referenceWeightsKg: {
      child: row.child_reference_weight_kg ?? 35,
      normal: row.normal_reference_weight_kg ?? 80,
      heavy: row.heavy_reference_weight_kg ?? 110,
    },
    plannedBoardingMinutes: row.planned_boarding_minutes ?? 8,
    plannedDeboardingMinutes: row.planned_deboarding_minutes ?? 5,
    plannedBufferMinutes: row.planned_buffer_minutes ?? 3,
    updatedAt: row.updated_at,
  };
}

export function safeErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unbekannter Fehler";
}
