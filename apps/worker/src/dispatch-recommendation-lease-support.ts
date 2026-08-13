import type { DispatchRecommendationLease } from "@rundflug/contracts";
import type { selectReusableDispatchBatch } from "./dispatch-recommendation-selection";

export interface StoredDispatchRecommendationLease {
  id: string;
  operation_day_id: string;
  aircraft_id: string;
  operator_account_id: string;
  device_id: string;
  acquire_command_id: string;
  dispatch_plan_revision: string;
  dispatch_batch_id: string;
  dispatch_order: number;
  ticket_group_ids_json: string;
  occupied_seats: number;
  available_seats: number;
  decision_reasons_json: string;
  operation_day_version: number;
  member_rotation_ids_json: string;
  status: "ACTIVE" | "RELEASED" | "EXPIRED" | "CONSUMED" | "INVALIDATED";
  acquired_at: string;
  expires_at: string;
  version: number;
}

export function dispatchRecommendationLeaseResponse(
  lease: StoredDispatchRecommendationLease,
  serverNow: string,
): DispatchRecommendationLease {
  return {
    leaseId: lease.id,
    aircraftId: lease.aircraft_id,
    planRevision: lease.dispatch_plan_revision,
    batchId: lease.dispatch_batch_id,
    dispatchOrder: lease.dispatch_order,
    groupIds: strings(lease.ticket_group_ids_json),
    occupiedSeats: lease.occupied_seats,
    availableSeats: lease.available_seats,
    decisionReasons: strings(lease.decision_reasons_json),
    acquiredAt: lease.acquired_at,
    expiresAt: lease.expires_at,
    serverNow,
  };
}

export interface DispatchRecommendationAircraft {
  id: string;
  passenger_seats: number;
  operational_state: string;
  resource_group_id: string;
  current_pilot_id: string | null;
}

export interface DispatchRecommendationPlanningRow {
  rotation_id: string;
  created_at: string;
  segment_order: number;
  communication_number: number;
  queue_sequence: number;
  product_id: string;
  gate_id: string;
  group_ids_json: string;
  sold_at: string;
  standby: number;
  attendance_status: "WAITING" | "PRESENT" | "MISSING" | "CLARIFICATION";
  ticket_count: number;
  reference_duration_minutes: number;
  precalled_at: string | null;
  precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
  dispatch_plan_revision: string | null;
  dispatch_batch_id: string | null;
  dispatch_order: number | null;
  dispatch_wave: number | null;
  dispatch_group_ids_json: string;
  dispatch_occupied_seats: number | null;
  dispatch_decision_reasons_json: string;
  dispatch_confirmed_overtake_count: number;
  dispatch_projected_overtake_count: number;
  prediction_updated_at: string | null;
  reserved_by_active_lease: number;
}

export function strings(value: string): string[] {
  return (JSON.parse(value) as unknown[]).filter(
    (entry): entry is string => typeof entry === "string",
  );
}

export function planningGroupIndex(rows: readonly DispatchRecommendationPlanningRow[]) {
  const planningGroupIds = new Map<string, DispatchRecommendationPlanningRow[]>();
  const groupIdsByRotationId = new Map<string, string[]>();
  for (const row of rows) {
    const groupIds = strings(row.group_ids_json);
    groupIdsByRotationId.set(row.rotation_id, groupIds);
    for (const groupId of groupIds) {
      const segments = planningGroupIds.get(groupId) ?? [];
      segments.push(row);
      planningGroupIds.set(groupId, segments);
    }
  }
  const firstRotationByGroupId = new Map<string, string>();
  for (const [groupId, segments] of planningGroupIds) {
    segments.sort(
      (left, right) =>
        left.segment_order - right.segment_order ||
        left.created_at.localeCompare(right.created_at) ||
        left.rotation_id.localeCompare(right.rotation_id),
    );
    const first = segments[0];
    if (first) firstRotationByGroupId.set(groupId, first.rotation_id);
  }
  return { groupIdsByRotationId, firstRotationByGroupId };
}

export function selectedDispatchBatch(selection: ReturnType<typeof selectReusableDispatchBatch>) {
  const batch = selection.batch;
  if (batch) return batch;
  return {
    planRevision: "",
    batchId: "",
    dispatchOrder: 0,
    memberRotationIds: [] as string[],
    groupIds: [] as string[],
    occupiedSeats: 0,
    decisionReasons: [] as string[],
  };
}
