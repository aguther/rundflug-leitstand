import type { forecastQueueWindows, resolveTurnaroundProfile } from "@rundflug/domain";
import { compositeIndexKey } from "./operations-projection-indexes";

type TurnaroundProfile = ReturnType<typeof resolveTurnaroundProfile>;

export function forecastWindow(
  firstQueuedRotation:
    | {
        prediction_lower_minutes: number | null;
        prediction_upper_minutes: number | null;
        prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
      }
    | undefined,
  preOperationsOffset: number,
  fallback: ReturnType<typeof forecastQueueWindows>,
): ReturnType<typeof forecastQueueWindows> {
  if (firstQueuedRotation) {
    return {
      lowerMinutes: firstQueuedRotation.prediction_lower_minutes ?? 0,
      upperMinutes: firstQueuedRotation.prediction_upper_minutes ?? 0,
      quality: firstQueuedRotation.prediction_quality ?? fallback.quality,
    };
  }
  if (preOperationsOffset > 0) {
    return {
      lowerMinutes: Math.max(0, Math.round(preOperationsOffset - 5)),
      upperMinutes: Math.round(preOperationsOffset + 5),
      quality: "CHANGING",
    };
  }
  return fallback;
}

export function forecastWindowCenterMs(
  storedCenterMs: number,
  referenceMs: number,
  lowerMinutes: number,
  midpointMinutes: number,
): number {
  if (Number.isFinite(storedCenterMs)) {
    return storedCenterMs + (lowerMinutes - midpointMinutes) * 60_000;
  }
  return referenceMs + lowerMinutes * 60_000;
}

function frozenTurnaroundSource(
  source: string | null,
  fallback: TurnaroundProfile["boarding"],
): Pick<TurnaroundProfile["boarding"], "sourceLevel" | "sourceId"> {
  const separator = source?.indexOf(":") ?? -1;
  const sourceLevel = source?.slice(0, separator);
  if (separator > 0 && ["AIRCRAFT_PRODUCT", "PRODUCT", "EVENT"].includes(sourceLevel ?? "")) {
    return {
      sourceLevel: sourceLevel as "AIRCRAFT_PRODUCT" | "PRODUCT" | "EVENT",
      sourceId: source?.slice(separator + 1) ?? fallback.sourceId,
    };
  }
  return { sourceLevel: fallback.sourceLevel, sourceId: fallback.sourceId };
}

export function effectiveRotationTurnaroundProfile(
  rotation: {
    turnaround_boarding_minutes: number | null;
    turnaround_boarding_source: string | null;
    turnaround_deboarding_minutes: number | null;
    turnaround_deboarding_source: string | null;
    turnaround_buffer_minutes: number | null;
    turnaround_buffer_source: string | null;
  },
  resolved: TurnaroundProfile,
): TurnaroundProfile {
  if (
    rotation.turnaround_boarding_minutes === null ||
    rotation.turnaround_deboarding_minutes === null ||
    rotation.turnaround_buffer_minutes === null
  ) {
    return resolved;
  }
  return {
    boarding: {
      valueMinutes: rotation.turnaround_boarding_minutes,
      ...frozenTurnaroundSource(rotation.turnaround_boarding_source, resolved.boarding),
    },
    deboarding: {
      valueMinutes: rotation.turnaround_deboarding_minutes,
      ...frozenTurnaroundSource(rotation.turnaround_deboarding_source, resolved.deboarding),
    },
    buffer: {
      valueMinutes: rotation.turnaround_buffer_minutes,
      ...frozenTurnaroundSource(rotation.turnaround_buffer_source, resolved.buffer),
    },
    totalGroundMinutes:
      rotation.turnaround_boarding_minutes +
      rotation.turnaround_deboarding_minutes +
      rotation.turnaround_buffer_minutes,
  };
}

export function activePilot<T extends { active: number; paused: number }>(
  candidate: T | undefined,
  requireIdle = false,
): T | undefined {
  if (candidate?.active !== 1 || candidate.paused !== 0) return undefined;
  if (requireIdle && "current_rotation_id" in candidate && candidate.current_rotation_id !== null) {
    return undefined;
  }
  return candidate;
}

export function currentDispatchValue<T>(
  dispatchVersion: number | null,
  eventVersion: number,
  values: ReadonlyMap<string, T>,
  key: string | null,
): T | undefined {
  return dispatchVersion === eventVersion ? values.get(key ?? "") : undefined;
}

export function forecastProfileAircraftId(
  assignedAircraftId: string | null,
  forecastAircraftId: string | null,
  dispatchPlanFresh: boolean,
): string | null {
  if (assignedAircraftId) return assignedAircraftId;
  return dispatchPlanFresh ? forecastAircraftId : null;
}

export function aircraftProductOverrideFor<T>(
  values: ReadonlyMap<string, T>,
  aircraftId: string | null,
  productId: string | null,
): T | undefined {
  return aircraftId ? values.get(compositeIndexKey(aircraftId, productId)) : undefined;
}

export function precallDecisionProjection(rotation: {
  precall_decision_status: string | null;
  precall_decision_reason: string | null;
  precall_decision_at: string | null;
  precall_dispatch_reason: string | null;
  precall_predicted_boarding_at: string | null;
  precall_adaptive_lead_minutes: number | null;
  precall_gate_id: string | null;
  precall_adaptive_base_lead_minutes: number | null;
  precall_gate_travel_lead_minutes: number | null;
  precall_effective_lead_minutes: number | null;
  precall_boarding_window_lower_at: string | null;
  precall_boarding_window_upper_at: string | null;
}) {
  if (
    !rotation.precall_decision_status ||
    !rotation.precall_decision_reason ||
    !rotation.precall_decision_at
  ) {
    return null;
  }
  return {
    status: rotation.precall_decision_status,
    reason: rotation.precall_dispatch_reason ?? rotation.precall_decision_reason,
    decidedAt: rotation.precall_decision_at,
    predictedBoardingAt: rotation.precall_predicted_boarding_at,
    adaptiveLeadMinutes: rotation.precall_adaptive_lead_minutes,
    gateId: rotation.precall_gate_id,
    adaptiveBaseLeadMinutes: rotation.precall_adaptive_base_lead_minutes,
    gateTravelLeadMinutes: rotation.precall_gate_travel_lead_minutes,
    effectiveLeadMinutes: rotation.precall_effective_lead_minutes,
    boardingWindowLowerAt: rotation.precall_boarding_window_lower_at,
    boardingWindowUpperAt: rotation.precall_boarding_window_upper_at,
  };
}

export function dispatchPlanProjection(
  rotation: {
    dispatch_plan_id: string | null;
    dispatch_plan_revision: string | null;
    dispatch_batch_id: string | null;
    dispatch_order: number | null;
    dispatch_wave: number | null;
    dispatch_lane_id: string | null;
    dispatch_group_ids_json: string;
    dispatch_occupied_seats: number | null;
    dispatch_available_seats: number | null;
    dispatch_commitment_level: string | null;
    dispatch_decision_reasons_json: string;
    dispatch_confirmed_overtake_count: number;
    dispatch_projected_overtake_count: number;
    dispatch_unplanned_reason: string | null;
  },
  fresh: boolean,
) {
  if (!fresh || !rotation.dispatch_plan_id || !rotation.dispatch_plan_revision) return null;
  return {
    planId: rotation.dispatch_plan_id,
    revision: rotation.dispatch_plan_revision,
    batchId: rotation.dispatch_batch_id,
    dispatchOrder: rotation.dispatch_order,
    wave: rotation.dispatch_wave,
    laneId: rotation.dispatch_lane_id,
    groupIds: JSON.parse(rotation.dispatch_group_ids_json) as string[],
    occupiedSeats: rotation.dispatch_occupied_seats,
    availableSeats: rotation.dispatch_available_seats,
    commitmentLevel: rotation.dispatch_commitment_level,
    decisionReasons: JSON.parse(rotation.dispatch_decision_reasons_json) as string[],
    confirmedOvertakeCount: rotation.dispatch_confirmed_overtake_count,
    projectedOvertakeCount: rotation.dispatch_projected_overtake_count,
    unplannedReason: rotation.dispatch_unplanned_reason,
  };
}
