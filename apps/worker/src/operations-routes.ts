import { gateDisplayFilterSchema } from "@rundflug/contracts";
import {
  assessForecastFreshness,
  assessMarginalProductCapacity,
  createQueueAvailability,
  deriveResourceGroupCapacity,
  estimateDuration,
  forecastQueueWindows,
  formatFlightGroupLabel,
  resolveTurnaroundProfile,
} from "@rundflug/domain";
import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import {
  compositeIndexKey,
  createOperationsProjectionIndexes,
} from "./operations-projection-indexes";
import { loadOperationsReadModels } from "./operations-read-service";
import {
  activeTicketGroupRecallProjection,
  predictedBoardingWindow,
} from "./public-status-projection";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  loadOperationsReadModels,
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now(),
  performanceNow: () => performance.now(),
};

export type OperationsRouteDependencies = typeof defaultDependencies;

type TurnaroundProfile = ReturnType<typeof resolveTurnaroundProfile>;

function forecastWindow(
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

function forecastWindowCenterMs(
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

function effectiveRotationTurnaroundProfile(
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

function activePilot<T extends { active: number; paused: number }>(
  candidate: T | undefined,
  requireIdle = false,
): T | undefined {
  if (candidate?.active !== 1 || candidate.paused !== 0) return undefined;
  if (requireIdle && "current_rotation_id" in candidate && candidate.current_rotation_id !== null) {
    return undefined;
  }
  return candidate;
}

function currentDispatchValue<T>(
  dispatchVersion: number | null,
  eventVersion: number,
  values: ReadonlyMap<string, T>,
  key: string | null,
): T | undefined {
  return dispatchVersion === eventVersion ? values.get(key ?? "") : undefined;
}

function forecastProfileAircraftId(
  assignedAircraftId: string | null,
  forecastAircraftId: string | null,
  dispatchPlanFresh: boolean,
): string | null {
  if (assignedAircraftId) return assignedAircraftId;
  return dispatchPlanFresh ? forecastAircraftId : null;
}

function aircraftProductOverrideFor<T>(
  values: ReadonlyMap<string, T>,
  aircraftId: string | null,
  productId: string | null,
): T | undefined {
  return aircraftId ? values.get(compositeIndexKey(aircraftId, productId)) : undefined;
}

function precallDecisionProjection(rotation: {
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

function dispatchPlanProjection(
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

export function registerOperationsRoutes(
  app: WorkerApp,
  dependencies: OperationsRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/operations", async (context) => {
    const requestStartedAt = dependencies.performanceNow();
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(
      context.env,
      eventId,
      context.req.raw,
      context.get("sessionActor"),
    );
    if (!device || device.role === "DISPLAY") {
      return context.json(
        {
          error: {
            code: "SESSION_NOT_AUTHORIZED",
            message: "Sitzung für diese Ansicht nicht berechtigt.",
          },
        },
        403,
      );
    }

    const eventRow = await context.env.DB.prepare(
      `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
              emergency_mode, operational_interrupted, version,
              operational_note, operations_start_at, operations_end_at, sale_opens_at,
              no_show_after_minutes,
              max_ticket_deferrals,
              notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
              automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
              precall_min_quality, precall_gate_cooldown_minutes,
              heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
              planned_buffer_minutes, logo_object_key, logo_dark_object_key, updated_at
         FROM operation_days WHERE id = ?1`,
    )
      .bind(eventId)
      .first<StoredEventRow>();
    if (!eventRow) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    const projectionReadAt = dependencies.nowIso();

    const loadReadModels = dependencies.loadOperationsReadModels;
    const readModels = await loadReadModels(context.env.DB, eventId, projectionReadAt);
    const {
      products,
      aircraftProductTurnaroundOverrideRows,
      rotations,
      queueGroupRows,
      dispatchLeaseRows,
      durationRows,
      fleetRows,
      pilotRows,
      gatesRows,
      resourceGroupRows,
      plannedOperationRows,
      recurringRuleRows,
      metricsRow,
      assistClaims,
    } = readModels;

    const actualDurations = [...durationRows.results].reverse().map((row) => row.duration_minutes);
    const activePilotCount = pilotRows.results.filter(
      (pilot) => pilot.active === 1 && pilot.paused === 0,
    ).length;
    const forecastReadAt = dependencies.nowIso();
    const forecastReferenceMs = Date.parse(forecastReadAt);
    const operationsEnd = eventRow.operations_end_at ? Date.parse(eventRow.operations_end_at) : 0;
    const operationsEndMinutes = Math.max(0, (operationsEnd - forecastReferenceMs) / 60_000);
    const {
      productsById,
      productsByCode,
      aircraftRowsByResourceGroupId,
      fleetById,
      fleetByResourceGroupId,
      pilotsById,
      rotationsById,
      rotationsByResourceGroupId,
      rotationsByResourceGroupAircraftId,
      resourceGroupsById,
      turnaroundOverridesByAircraftProduct,
      activePlanOrderById,
      planScopeIndexKey,
      activePlansByScope,
      activeRecurringRuleOrderById,
      activeRecurringRulesByScope,
      firstQueuedRotationByResourceGroupId,
      availablePilotsFor,
    } = createOperationsProjectionIndexes(readModels, forecastReferenceMs);
    const dispatchReservationByGroupId = new Map<string, "OWN" | "OTHER">();
    for (const lease of dispatchLeaseRows.results) {
      const reservation =
        device.accountId !== null &&
        lease.operator_account_id === device.accountId &&
        lease.device_id === device.id
          ? "OWN"
          : "OTHER";
      if (reservation === "OWN" || !dispatchReservationByGroupId.has(lease.ticket_group_id)) {
        dispatchReservationByGroupId.set(lease.ticket_group_id, reservation);
      }
    }

    const response = context.json({
      currentDeviceRole: device.role,
      event: rowToSnapshot(eventRow),
      products: products.results.map((product) => {
        const effectiveTurnaroundProfile = resolveTurnaroundProfile({
          event: {
            sourceId: eventId,
            boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
            deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
            bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
          },
          product: {
            sourceId: product.id,
            boardingMinutes: product.planned_boarding_minutes_override,
            deboardingMinutes: product.planned_deboarding_minutes_override,
            bufferMinutes: product.planned_buffer_minutes_override,
          },
        });
        const assignedGroupAircraft =
          aircraftRowsByResourceGroupId.get(product.resource_group_id) ?? [];
        const operationalGroupAircraft = assignedGroupAircraft.filter(
          (aircraft) =>
            !["INACTIVE", "PAUSED", "REFUELING"].includes(aircraft.operational_state) &&
            aircraft.operational_interrupted === 0,
        );
        const allGroupAircraftSeats = assignedGroupAircraft.map(
          (aircraft) => aircraft.passenger_seats,
        );
        const groupAircraftSeats = operationalGroupAircraft
          .map((aircraft) => aircraft.passenger_seats)
          .slice(0, activePilotCount);
        const effectiveReferenceCapacity = Math.max(
          1,
          deriveResourceGroupCapacity(allGroupAircraftSeats),
        );
        const activeAircraft = groupAircraftSeats.length;
        const queueSequence = Math.max(
          1,
          Math.ceil(product.queued_tickets / product.reference_capacity),
        );
        const duration = estimateDuration({
          referenceMinutes:
            product.reference_duration_minutes + effectiveTurnaroundProfile.totalGroundMinutes,
          actualDurationsMinutes: actualDurations,
          interrupted:
            product.resource_group_status !== "ACTIVE" ||
            eventRow.emergency_mode === 1 ||
            eventRow.operational_interrupted === 1,
          activeCapacity: activeAircraft,
        });
        const fallbackForecast = forecastQueueWindows({ queueSequence, activeAircraft, duration });
        const firstQueuedRotation = firstQueuedRotationByResourceGroupId.get(
          product.resource_group_id,
        );
        const preOperationsOffset = eventRow.operations_start_at
          ? Math.max(0, (Date.parse(eventRow.operations_start_at) - forecastReferenceMs) / 60_000)
          : 0;
        const forecast = forecastWindow(firstQueuedRotation, preOperationsOffset, fallbackForecast);
        const forecastMidpointMinutes = (forecast.lowerMinutes + forecast.upperMinutes) / 2;
        const storedForecastCenterMs = firstQueuedRotation?.predicted_boarding_at
          ? Date.parse(firstQueuedRotation.predicted_boarding_at)
          : Number.NaN;
        const nextBoardingWindowLowerAt =
          forecast.quality === "UNCERTAIN"
            ? null
            : new Date(
                forecastWindowCenterMs(
                  storedForecastCenterMs,
                  forecastReferenceMs,
                  forecast.lowerMinutes,
                  forecastMidpointMinutes,
                ),
              ).toISOString();
        const nextBoardingWindowUpperAt =
          forecast.quality === "UNCERTAIN"
            ? null
            : new Date(
                Date.parse(
                  nextBoardingWindowLowerAt ?? new Date(forecastReferenceMs).toISOString(),
                ) +
                  Math.max(0, forecast.upperMinutes - forecast.lowerMinutes) * 60_000,
              ).toISOString();
        const resourceGroupRotations =
          rotationsByResourceGroupId.get(product.resource_group_id) ?? [];
        const blockingUnprojectedQueue = resourceGroupRotations.some(
          (rotation) =>
            rotation.status === "DRAFT" &&
            rotation.ticket_count > 0 &&
            rotation.predicted_completion_at === null &&
            !["ATTENDANCE_MISSING", "ATTENDANCE_CLARIFICATION"].includes(
              rotation.dispatch_unplanned_reason ?? "",
            ),
        );
        const availablePilots = availablePilotsFor(product.resource_group_id);
        const compatibleAircraftTypes = new Set(
          JSON.parse(
            resourceGroupsById.get(product.resource_group_id)?.compatible_aircraft_types_json ??
              "[]",
          ) as string[],
        );
        const capacityLanes =
          eventRow.operational_interrupted === 1 ||
          product.resource_group_status !== "ACTIVE" ||
          blockingUnprojectedQueue
            ? []
            : (fleetByResourceGroupId.get(product.resource_group_id) ?? [])
                .filter(
                  (aircraft) =>
                    aircraft.operational_state !== "INACTIVE" &&
                    (compatibleAircraftTypes.size === 0 ||
                      compatibleAircraftTypes.has(aircraft.aircraft_type)),
                )
                .flatMap((aircraft) => {
                  const assignedRotations =
                    rotationsByResourceGroupAircraftId.get(
                      compositeIndexKey(product.resource_group_id, aircraft.id),
                    ) ?? [];
                  const unknownReturn =
                    (aircraft.operational_interrupted === 1 ||
                      ["PAUSED", "REFUELING"].includes(aircraft.operational_state)) &&
                    aircraft.expected_review_at === null &&
                    !assignedRotations.some(
                      (rotation) => rotation.predicted_completion_at !== null,
                    );
                  if (unknownReturn) return [];
                  const projectedCompletions = assignedRotations.flatMap((rotation) => {
                    if (!rotation.predicted_completion_at) return [];
                    const expectedMinutes = Math.max(
                      0,
                      (Date.parse(rotation.predicted_completion_at) - forecastReferenceMs) / 60_000,
                    );
                    const intervalWidth = Math.max(
                      0,
                      (rotation.prediction_upper_minutes ?? 0) -
                        (rotation.prediction_lower_minutes ?? 0),
                    );
                    return [
                      {
                        lowerMinutes: Math.max(0, expectedMinutes - intervalWidth / 2),
                        expectedMinutes,
                        upperMinutes: expectedMinutes + intervalWidth / 2,
                      },
                    ];
                  });
                  const returnMinutes = aircraft.expected_review_at
                    ? Math.max(
                        0,
                        (Date.parse(aircraft.expected_review_at) - forecastReferenceMs) / 60_000,
                      )
                    : 0;
                  return [
                    {
                      aircraft,
                      lowerMinutes: Math.max(
                        returnMinutes,
                        ...projectedCompletions.map((entry) => entry.lowerMinutes),
                      ),
                      expectedMinutes: Math.max(
                        returnMinutes,
                        ...projectedCompletions.map((entry) => entry.expectedMinutes),
                      ),
                      upperMinutes: Math.max(
                        returnMinutes,
                        ...projectedCompletions.map((entry) => entry.upperMinutes),
                      ),
                    },
                  ];
                })
                .sort(
                  (left, right) =>
                    left.expectedMinutes - right.expectedMinutes ||
                    left.aircraft.id.localeCompare(right.aircraft.id),
                )
                .slice(0, availablePilots.length)
                .flatMap((lane, index) => {
                  const pilot = availablePilots[index];
                  if (!pilot) return [];
                  const predictedCompletionForRelevantRotation = (rotationId: string | null) => {
                    const rotation = rotationsById.get(rotationId ?? "");
                    return rotation?.resource_group_id === product.resource_group_id
                      ? rotation.predicted_completion_at
                      : null;
                  };
                  const applicablePlans = [
                    ...(activePlansByScope.get(planScopeIndexKey("EVENT", eventId)) ?? []),
                    ...(activePlansByScope.get(
                      planScopeIndexKey("RESOURCE_GROUP", product.resource_group_id),
                    ) ?? []),
                    ...(activePlansByScope.get(planScopeIndexKey("AIRCRAFT", lane.aircraft.id)) ??
                      []),
                    ...(activePlansByScope.get(planScopeIndexKey("PILOT", pilot.id)) ?? []),
                  ].sort(
                    (left, right) =>
                      (activePlanOrderById.get(left.id) ?? 0) -
                      (activePlanOrderById.get(right.id) ?? 0),
                  );
                  const unknownConstraintStart = applicablePlans.some(
                    (plan) =>
                      plan.start_mode === "AFTER_CURRENT_ROTATION" &&
                      !predictedCompletionForRelevantRotation(plan.after_rotation_id),
                  );
                  if (unknownConstraintStart) return [];
                  const constraints = applicablePlans.map((plan) => {
                    const afterRotationCompletion = predictedCompletionForRelevantRotation(
                      plan.after_rotation_id,
                    );
                    const earliestStart =
                      plan.start_mode === "AFTER_CURRENT_ROTATION"
                        ? Date.parse(afterRotationCompletion ?? forecastReadAt)
                        : Date.parse(plan.earliest_start_at ?? forecastReadAt);
                    const latestStart =
                      plan.start_mode === "AFTER_CURRENT_ROTATION"
                        ? earliestStart
                        : Date.parse(
                            plan.latest_start_at ?? plan.earliest_start_at ?? forecastReadAt,
                          );
                    const earliestStartMinutes = Math.max(
                      0,
                      (earliestStart - forecastReferenceMs) / 60_000,
                    );
                    const latestStartMinutes = Math.max(
                      earliestStartMinutes,
                      (latestStart - forecastReferenceMs) / 60_000,
                    );
                    return {
                      id: plan.id,
                      earliestStartMinutes,
                      expectedStartMinutes: (earliestStartMinutes + latestStartMinutes) / 2,
                      latestStartMinutes,
                      minimumDurationMinutes: plan.minimum_duration_minutes,
                      typicalDurationMinutes: plan.typical_duration_minutes,
                      maximumDurationMinutes: plan.maximum_duration_minutes,
                      effectMode: plan.effect_mode,
                      durationMultiplierPercent: plan.duration_multiplier_percent,
                      active: plan.status === "ACTIVE",
                    };
                  });
                  const recurringConstraints = [
                    ...(activeRecurringRulesByScope.get(
                      compositeIndexKey("AIRCRAFT", lane.aircraft.id),
                    ) ?? []),
                    ...(activeRecurringRulesByScope.get(compositeIndexKey("PILOT", pilot.id)) ??
                      []),
                  ]
                    .sort(
                      (left, right) =>
                        (activeRecurringRuleOrderById.get(left.id) ?? 0) -
                        (activeRecurringRuleOrderById.get(right.id) ?? 0),
                    )
                    .map((rule) => ({
                      id: rule.id,
                      triggerMetric: rule.trigger_metric,
                      intervalValue: rule.interval_value,
                      lowerProgress: rule.progress_value,
                      expectedProgress: rule.progress_value,
                      upperProgress: rule.progress_value,
                      minimumDurationMinutes: rule.minimum_duration_minutes,
                      typicalDurationMinutes: rule.typical_duration_minutes,
                      maximumDurationMinutes: rule.maximum_duration_minutes,
                      active: true,
                    }));
                  return [
                    {
                      laneId: `${lane.aircraft.id}:${pilot.id}`,
                      aircraftId: lane.aircraft.id,
                      passengerSeats: lane.aircraft.passenger_seats,
                      lowerMinutes: Math.max(lane.lowerMinutes, pilot.availableMinutes),
                      expectedMinutes: Math.max(lane.expectedMinutes, pilot.availableMinutes),
                      upperMinutes: Math.max(lane.upperMinutes, pilot.availableMinutes),
                      constraints,
                      recurringConstraints,
                    },
                  ];
                });
        const availabilityAfterQueue = createQueueAvailability({
          activeAircraft: 0,
          busyAircraftMinutes: [],
          lanes: capacityLanes,
        });
        const durationByAircraftId = new Map(
          capacityLanes.map((lane) => {
            const override = turnaroundOverridesByAircraftProduct.get(
              compositeIndexKey(lane.aircraftId, product.id),
            );
            const aircraftProfile = resolveTurnaroundProfile({
              event: {
                sourceId: eventId,
                boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
                deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
                bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
              },
              product: {
                sourceId: product.id,
                boardingMinutes: product.planned_boarding_minutes_override,
                deboardingMinutes: product.planned_deboarding_minutes_override,
                bufferMinutes: product.planned_buffer_minutes_override,
              },
              ...(override
                ? {
                    aircraftProduct: {
                      sourceId: `${override.aircraft_id}:${override.product_id}`,
                      boardingMinutes: override.planned_boarding_minutes_override,
                      deboardingMinutes: override.planned_deboarding_minutes_override,
                      bufferMinutes: override.planned_buffer_minutes_override,
                    },
                  }
                : {}),
            });
            return [
              lane.aircraftId,
              estimateDuration({
                referenceMinutes:
                  product.reference_duration_minutes + aircraftProfile.totalGroundMinutes,
                actualDurationsMinutes: actualDurations,
                interrupted: false,
                activeCapacity: Math.max(1, capacityLanes.length),
              }),
            ] as const;
          }),
        );
        const queuedSeatsCompletedByEnd = resourceGroupRotations
          .filter(
            (rotation) =>
              rotation.status === "DRAFT" &&
              rotation.predicted_completion_at !== null &&
              Date.parse(rotation.predicted_completion_at) <= operationsEnd,
          )
          .reduce((sum, rotation) => sum + rotation.ticket_count, 0);
        const capacity = assessMarginalProductCapacity({
          operationsEndMinutes,
          availabilityAfterQueue,
          duration,
          durationByAircraftId,
          queuedSeatsCompletedByEnd,
          openTickets: product.resource_group_open_tickets,
          predictionQuality: forecast.quality,
          warningThreshold: product.capacity_warning_threshold,
          criticalThreshold: product.capacity_critical_threshold,
        });
        return {
          id: product.id,
          code: product.code,
          name: product.name,
          publicDescription: product.public_description,
          resourceGroupId: product.resource_group_id,
          resourceGroupName: product.resource_group_name,
          resourceGroupStatus: product.resource_group_status,
          resourceGroupOperationalNote: product.resource_group_operational_note,
          priceCents: product.price_cents,
          gateId: product.gate_id,
          gateLabel: product.gate_label,
          childCompanionRequired: product.child_companion_required === 1,
          weightClasses: JSON.parse(product.weight_classes_json) as Array<
            "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
          >,
          sortOrder: product.sort_order,
          saleEnabled: product.sale_enabled === 1,
          referenceCapacity: effectiveReferenceCapacity,
          referenceDurationMinutes: product.reference_duration_minutes,
          promisedFlightMinutes: product.promised_flight_minutes,
          plannedBoardingMinutesOverride: product.planned_boarding_minutes_override,
          plannedDeboardingMinutesOverride: product.planned_deboarding_minutes_override,
          plannedBufferMinutesOverride: product.planned_buffer_minutes_override,
          effectiveTurnaroundProfile,
          queuedTickets: product.queued_tickets,
          resourceGroupOpenTickets: product.resource_group_open_tickets,
          estimatedWaitLowerMinutes: forecast.lowerMinutes,
          estimatedWaitUpperMinutes: forecast.upperMinutes,
          nextBoardingWindowLowerAt,
          nextBoardingWindowUpperAt,
          remainingSellableSeats: capacity.remainingSellableSeats,
          projectedSeats: capacity.projectedSeats,
          capacityStatus: capacity.status,
          saleRecommended:
            capacity.saleRecommended &&
            eventRow.status === "ACTIVE" &&
            product.sale_enabled === 1 &&
            product.resource_group_status === "ACTIVE" &&
            eventRow.emergency_mode === 0 &&
            eventRow.operational_interrupted !== 1 &&
            (product.sale_closes_at === null ||
              Date.parse(product.sale_closes_at) > dependencies.nowMs()) &&
            (!eventRow.sale_opens_at || Date.parse(eventRow.sale_opens_at) <= dependencies.nowMs()),
          saleClosesAt: product.sale_closes_at,
          capacityWarningThreshold: product.capacity_warning_threshold,
          capacityCriticalThreshold: product.capacity_critical_threshold,
          predictionQuality: forecast.quality,
        };
      }),
      aircraftProductTurnaroundOverrides: aircraftProductTurnaroundOverrideRows.results.flatMap(
        (override) => {
          const product = productsById.get(override.product_id);
          if (!product) return [];
          return [
            {
              aircraftId: override.aircraft_id,
              productId: override.product_id,
              version: override.version,
              plannedBoardingMinutesOverride: override.planned_boarding_minutes_override,
              plannedDeboardingMinutesOverride: override.planned_deboarding_minutes_override,
              plannedBufferMinutesOverride: override.planned_buffer_minutes_override,
              effectiveTurnaroundProfile: resolveTurnaroundProfile({
                event: {
                  sourceId: eventId,
                  boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
                  deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
                  bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
                },
                product: {
                  sourceId: product.id,
                  boardingMinutes: product.planned_boarding_minutes_override,
                  deboardingMinutes: product.planned_deboarding_minutes_override,
                  bufferMinutes: product.planned_buffer_minutes_override,
                },
                aircraftProduct: {
                  sourceId: `${override.aircraft_id}:${override.product_id}`,
                  boardingMinutes: override.planned_boarding_minutes_override,
                  deboardingMinutes: override.planned_deboarding_minutes_override,
                  bufferMinutes: override.planned_buffer_minutes_override,
                },
              }),
            },
          ];
        },
      ),
      rotations: rotations.results.map((rotation, index) => {
        const activeAircraft = (
          aircraftRowsByResourceGroupId.get(rotation.resource_group_id) ?? []
        ).filter(
          (aircraft) =>
            !["INACTIVE", "PAUSED", "REFUELING"].includes(aircraft.operational_state) &&
            aircraft.operational_interrupted === 0,
        ).length;
        const effectiveActiveCapacity = Math.min(activeAircraft, activePilotCount);
        const suggestedAircraft = fleetById.get(rotation.suggested_aircraft_id ?? "");
        const dispatchPlanFresh = rotation.dispatch_operation_day_version === eventRow.version;
        const dispatchAircraft = currentDispatchValue(
          rotation.dispatch_operation_day_version,
          eventRow.version,
          fleetById,
          rotation.forecast_assumed_aircraft_id,
        );
        const dispatchPilotId = rotation.dispatch_lane_id?.split(":")[1] ?? null;
        const dispatchPilot = activePilot(
          currentDispatchValue(
            rotation.dispatch_operation_day_version,
            eventRow.version,
            pilotsById,
            dispatchPilotId,
          ),
        );
        const rememberedPilotCandidate = pilotsById.get(suggestedAircraft?.current_pilot_id ?? "");
        const rememberedPilot = activePilot(rememberedPilotCandidate, true);
        const rotationProduct = productsByCode.get(rotation.product_code);
        const profileAircraftId = forecastProfileAircraftId(
          rotation.aircraft_id,
          rotation.forecast_assumed_aircraft_id,
          dispatchPlanFresh,
        );
        const aircraftProductOverride = aircraftProductOverrideFor(
          turnaroundOverridesByAircraftProduct,
          profileAircraftId,
          rotationProduct?.id ?? null,
        );
        const resolvedTurnaroundProfile = resolveTurnaroundProfile({
          event: {
            sourceId: eventId,
            boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
            deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
            bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
          },
          ...(rotationProduct
            ? {
                product: {
                  sourceId: rotationProduct.id,
                  boardingMinutes: rotationProduct.planned_boarding_minutes_override,
                  deboardingMinutes: rotationProduct.planned_deboarding_minutes_override,
                  bufferMinutes: rotationProduct.planned_buffer_minutes_override,
                },
              }
            : {}),
          ...(aircraftProductOverride && rotationProduct
            ? {
                aircraftProduct: {
                  sourceId: `${aircraftProductOverride.aircraft_id}:${rotationProduct.id}`,
                  boardingMinutes: aircraftProductOverride.planned_boarding_minutes_override,
                  deboardingMinutes: aircraftProductOverride.planned_deboarding_minutes_override,
                  bufferMinutes: aircraftProductOverride.planned_buffer_minutes_override,
                },
              }
            : {}),
        });
        const effectiveTurnaroundProfile = effectiveRotationTurnaroundProfile(
          rotation,
          resolvedTurnaroundProfile,
        );
        const forecastFreshness = assessForecastFreshness({
          predictionQuality: rotation.prediction_quality,
          predictionUpdatedAt: rotation.prediction_updated_at,
          now: forecastReadAt,
        });
        const forecastUnavailable =
          rotation.precall_decision_reason === "NO_FORECAST_CAPACITY" ||
          rotation.precall_decision_reason === "NO_FITTING_AIRCRAFT";
        const effectivePredictionQuality =
          eventRow.emergency_mode === 1 || forecastUnavailable
            ? "UNCERTAIN"
            : forecastFreshness.quality;
        const fallbackWindow = forecastQueueWindows({
          queueSequence: index + 1,
          activeAircraft: effectiveActiveCapacity,
          duration: estimateDuration({
            referenceMinutes:
              rotation.reference_duration_minutes + effectiveTurnaroundProfile.totalGroundMinutes,
            actualDurationsMinutes: actualDurations,
            interrupted: eventRow.emergency_mode === 1 || eventRow.operational_interrupted === 1,
            activeCapacity: effectiveActiveCapacity,
          }),
        });
        const predictedLowerMinutes = forecastUnavailable
          ? null
          : (rotation.prediction_lower_minutes ?? fallbackWindow.lowerMinutes);
        const predictedUpperMinutes = forecastUnavailable
          ? null
          : (rotation.prediction_upper_minutes ?? fallbackWindow.upperMinutes);
        const boardingWindow = predictedBoardingWindow({
          status: rotation.status,
          quality: effectivePredictionQuality,
          predictedBoardingAt: rotation.predicted_boarding_at,
          lowerMinutes: predictedLowerMinutes ?? 0,
          upperMinutes: predictedUpperMinutes ?? 0,
          referenceAt: forecastReadAt,
        });
        const predictedCompletionMs = rotation.predicted_completion_at
          ? Date.parse(rotation.predicted_completion_at)
          : Number.NaN;
        const operationsEndMs = eventRow.operations_end_at
          ? Date.parse(eventRow.operations_end_at)
          : Number.NaN;
        const overtimeMinutes =
          Number.isFinite(predictedCompletionMs) && Number.isFinite(operationsEndMs)
            ? Math.max(0, Math.ceil((predictedCompletionMs - operationsEndMs) / 60_000))
            : 0;
        return {
          id: rotation.id,
          version: rotation.version,
          flightGroupId: rotation.flight_group_id,
          communicationNumber: rotation.communication_number,
          communicationLabel: formatFlightGroupLabel(
            rotation.resource_group_short_code,
            rotation.communication_number,
          ),
          queuePosition: rotation.queue_position,
          productCode: rotation.product_code,
          productName: rotation.product_name,
          status: rotation.status,
          bookingGroups: JSON.parse(rotation.booking_groups_json),
          ticketGroupId: rotation.ticket_group_id,
          gateId: rotation.gate_id,
          gateLabel: rotation.gate_label,
          aircraftId: rotation.aircraft_id,
          aircraftRegistration: rotation.aircraft_registration,
          pilotId: rotation.pilot_id,
          pilotOperationalCode: rotation.pilot_operational_code,
          suggestedPilotId: dispatchPilot?.id ?? rememberedPilot?.id ?? rotation.suggested_pilot_id,
          suggestedPilotOperationalCode:
            dispatchPilot?.operational_code ??
            rememberedPilot?.operational_code ??
            rotation.suggested_pilot_operational_code,
          suggestedAircraftId:
            (dispatchPlanFresh ? rotation.forecast_assumed_aircraft_id : null) ??
            rotation.suggested_aircraft_id,
          suggestedAircraftRegistration:
            dispatchAircraft?.registration ?? rotation.suggested_aircraft_registration,
          ticketCount: rotation.ticket_count,
          baselineCapacity: rotation.baseline_capacity,
          usableCapacity: rotation.usable_capacity ?? rotation.baseline_capacity,
          capacityReduced:
            rotation.usable_capacity !== null &&
            rotation.usable_capacity < rotation.baseline_capacity,
          estimatedPassengerPayloadKg: rotation.estimated_passenger_payload_kg,
          predictedLowerMinutes,
          predictedUpperMinutes,
          boardingWindowLowerAt: boardingWindow.lowerAt,
          boardingWindowUpperAt: boardingWindow.upperAt,
          precalledAt: rotation.precalled_at,
          precallDecision: precallDecisionProjection(rotation),
          calledAt: rotation.called_at,
          dispatchPlan: dispatchPlanProjection(rotation, dispatchPlanFresh),
          deferralCount: rotation.deferral_count,
          operationalNote: rotation.operational_note,
          timeline: {
            planned: {
              boardingAt: rotation.planned_boarding_at,
              departureAt: rotation.planned_departure_at,
              landingAt: rotation.planned_landing_at,
              completionAt: rotation.planned_completion_at,
            },
            predicted: {
              boardingAt: rotation.predicted_boarding_at,
              departureAt: rotation.predicted_departure_at,
              landingAt: rotation.predicted_landing_at,
              completionAt: rotation.predicted_completion_at,
            },
            actual: {
              boardingAt: rotation.called_at,
              departureAt: rotation.departed_at,
              landingAt: rotation.landed_at,
              completionAt: rotation.completed_at,
            },
            predictionQuality: effectivePredictionQuality,
            predictionUpdatedAt: rotation.prediction_updated_at,
            forecastAssumedAircraftId: rotation.forecast_assumed_aircraft_id,
            extendsBeyondOperationsEnd: overtimeMinutes > 0,
            overtimeMinutes,
            effectiveTurnaroundProfile,
          },
          tickets: JSON.parse(rotation.tickets_json) as Array<{
            id: string;
            status:
              | "QUEUED"
              | "CHECKED_IN"
              | "CALLED"
              | "BOARDING"
              | "IN_FLIGHT"
              | "LANDED"
              | "COMPLETED"
              | "NO_SHOW"
              | "CANCELED"
              | "CLARIFICATION";
            attendanceStatus: "NOT_CHECKED_IN" | "CHECKED_IN";
          }>,
        };
      }),
      queueGroups: queueGroupRows.results.map((group) => ({
        id: group.id,
        communicationNumber: group.communication_number,
        productId: group.product_id,
        productCode: group.product_code,
        productName: group.product_name,
        resourceGroupId: group.resource_group_id,
        gateId: group.gate_id,
        queueSequence: group.queue_sequence,
        status: group.status,
        ticketCount: group.ticket_count,
        presentCount: group.present_count,
        nextSegmentTicketCount: group.next_segment_ticket_count,
        nextSegmentPresentCount: group.next_segment_present_count,
        segmentIndex: group.segment_index,
        segmentCount: group.segment_count,
        precalledAt: group.precalled_at,
        dispatchReservation: dispatchReservationByGroupId.get(group.id) ?? null,
        recalledAt: group.recall_started_at,
        recallCount: group.recall_count,
        activeRecall: activeTicketGroupRecallProjection(group),
      })),
      aircraft: fleetRows.results.map((aircraft) => ({
        id: aircraft.id,
        version: aircraft.version,
        registration: aircraft.registration,
        aircraftType: aircraft.aircraft_type,
        passengerSeats: aircraft.passenger_seats,
        maximumPassengerPayloadKg: aircraft.maximum_passenger_payload_kg,
        operationalState:
          aircraft.operational_interrupted === 1 ? "INTERRUPTED" : aircraft.operational_state,
        operationalStateChangedAt: aircraft.operational_state_changed_at,
        resourceGroupId: aircraft.resource_group_id ?? "",
        resourceGroupName: aircraft.resource_group_name ?? "Nicht zugeordnet",
        resourceGroupShortCode: aircraft.resource_group_short_code ?? "–",
        refuelPlanned: aircraft.refuel_planned === 1,
        rotationsSinceRefuel: aircraft.rotations_since_refuel,
        refuelReminderThreshold: aircraft.refuel_reminder_threshold,
        expectedReviewAt: aircraft.expected_review_at,
        currentPilotId: aircraft.current_pilot_id,
        currentPilotOperationalCode: aircraft.current_pilot_operational_code,
      })),
      assistClaims: assistClaims.map((claim) => ({
        aircraftId: claim.aircraft_id,
        claimedByCurrentOperator:
          device.accountId !== null && claim.operator_account_id === device.accountId,
        ownerLoginCode: claim.login_code,
        revision: claim.revision,
        claimedAt: claim.claimed_at,
        expiresAt: claim.expires_at,
      })),
      pilots: pilotRows.results.map((pilot) => ({
        id: pilot.id,
        operationalCode: pilot.operational_code,
        operationalNote: pilot.operational_note,
        active: pilot.active === 1,
        paused: pilot.paused === 1,
        pauseExpectedReviewAt: pilot.pause_expected_review_at,
        currentRotationId: pilot.current_rotation_id,
        currentCommunicationNumber: pilot.current_communication_number,
      })),
      plannedOperations: plannedOperationRows.results.map((plan) => ({
        id: plan.id,
        version: plan.version,
        scopeType: plan.scope_type,
        scopeId: plan.scope_id,
        kind: plan.constraint_kind,
        effectMode: plan.effect_mode,
        durationMultiplierPercent: plan.duration_multiplier_percent,
        startMode: plan.start_mode,
        earliestStartAt: plan.earliest_start_at,
        latestStartAt: plan.latest_start_at,
        afterRotationId: plan.after_rotation_id,
        minimumDurationMinutes: plan.minimum_duration_minutes,
        typicalDurationMinutes: plan.typical_duration_minutes,
        maximumDurationMinutes: plan.maximum_duration_minutes,
        status:
          plan.status === "PLANNED" &&
          ((plan.latest_start_at !== null &&
            Date.parse(plan.latest_start_at) <= dependencies.nowMs()) ||
            (plan.start_mode === "AFTER_CURRENT_ROTATION" &&
              ["COMPLETED", "CANCELED"].includes(plan.after_rotation_status ?? "")))
            ? "DUE"
            : plan.status,
        publicNote: plan.public_note,
        createdAt: plan.created_at,
        updatedAt: plan.updated_at,
        activatedAt: plan.activated_at,
        clearedAt: plan.cleared_at,
        canceledAt: plan.canceled_at,
        recurringRuleId: plan.recurring_rule_id,
        recurrenceSequence: plan.recurrence_sequence,
      })),
      recurringOperationalRules: recurringRuleRows.results.map((rule) => ({
        id: rule.id,
        operationDayId: rule.operation_day_id,
        version: rule.version,
        scopeType: rule.scope_type,
        scopeId: rule.scope_id,
        kind: rule.operation_kind,
        triggerMetric: rule.trigger_metric,
        intervalValue: rule.interval_value,
        progressValue: rule.progress_value,
        minimumDurationMinutes: rule.minimum_duration_minutes,
        typicalDurationMinutes: rule.typical_duration_minutes,
        maximumDurationMinutes: rule.maximum_duration_minutes,
        status: rule.status,
        sequenceNumber: rule.sequence_number,
        openPlannedOperationId: rule.open_plan_id,
        reason: rule.reason,
        lastResetAt: rule.last_reset_at,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at,
      })),
      gates: gatesRows.results.map((gate) => ({
        id: gate.id,
        label: gate.label,
        gateType: gate.gate_type,
        active: gate.active === 1,
        sortOrder: gate.sort_order,
        travelLeadMinutes: gate.travel_lead_minutes,
        displayFilter: gateDisplayFilterSchema.parse(JSON.parse(gate.display_filter_json)),
        assignedResourceGroupIds: JSON.parse(gate.assigned_resource_group_ids_json) as string[],
      })),
      resourceGroups: resourceGroupRows.results.map((group) => {
        const activeAircraftIds = JSON.parse(group.aircraft_ids_json) as string[];
        const effectiveReferenceCapacity = Math.max(
          1,
          deriveResourceGroupCapacity(
            activeAircraftIds.flatMap((aircraftId) => {
              const aircraft = fleetById.get(aircraftId);
              return aircraft ? [aircraft.passenger_seats] : [];
            }),
          ),
        );
        return {
          id: group.id,
          version: group.version,
          name: group.name,
          shortCode: group.short_code,
          status: group.status,
          operationalNote: group.operational_note,
          gateId: group.gate_id,
          gateLabel: group.gate_label,
          referenceCapacity: effectiveReferenceCapacity,
          compatibleAircraftTypes: [],
          automaticPrecallEnabled: group.automatic_precall_enabled === 1,
          activeAircraftIds,
        };
      }),
      metrics: {
        openTickets: metricsRow?.open_tickets ?? 0,
        soldTickets: metricsRow?.sold_tickets ?? 0,
        completedRotations: metricsRow?.completed_rotations ?? 0,
        activeRotations: metricsRow?.active_rotations ?? 0,
        averageBoardingMinutes: metricsRow?.average_boarding_minutes ?? null,
        averageFlightMinutes: metricsRow?.average_flight_minutes ?? null,
        averageTurnaroundMinutes: metricsRow?.average_turnaround_minutes ?? null,
        averageRotationMinutes: metricsRow?.average_rotation_minutes ?? null,
        averageWaitMinutes: metricsRow?.average_wait_minutes ?? null,
        informationalRevenueCents: metricsRow?.informational_revenue_cents ?? 0,
        activeDevices: metricsRow?.active_devices ?? 0,
        activePushSubscriptions: metricsRow?.active_push_subscriptions ?? 0,
      },
    });
    response.headers.set(
      "server-timing",
      `operations;dur=${(dependencies.performanceNow() - requestStartedAt).toFixed(1)}`,
    );
    return response;
  });
}
