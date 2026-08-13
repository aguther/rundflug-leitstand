import {
  DEFAULT_DISPATCH_PLANNING_LIMITS,
  type DispatchLockedBatchInput,
  type DispatchPlan,
  deriveAdaptivePrecallLeadMinutes,
  type ForecastTimelineProjection,
  type ForecastTimelinesInput,
  normalizePrecallObservation,
  compareTechnicalStrings as order,
  resolveTurnaroundProfile,
} from "@rundflug/domain";
import type { ForecastTimelineLoader } from "./forecast-timeline-loader";
import {
  availabilityWindow,
  blockedResourceAvailability,
  dispatchPredecessors,
  precallPublicStatus,
  productServiceDeficits,
  stringArray,
} from "./forecast-timeline-projector-support";

export type ForecastTimelineData = Awaited<ReturnType<ForecastTimelineLoader["load"]>>;
const ACTIVE_ROTATION_STATUSES = new Set(["CALLED", "IN_FLIGHT", "LANDED"]);

export function applyActiveForecastProjections(
  data: ForecastTimelineData,
  projections: readonly ForecastTimelineProjection[],
): ForecastTimelineData | null {
  const projectionByRotationId = new Map(
    projections.map((projection) => [projection.rotationId, projection]),
  );
  const activeRotations = data.rotationRows.results.filter((rotation) =>
    ACTIVE_ROTATION_STATUSES.has(rotation.status),
  );
  const activeTimelineChanged = activeRotations.some((rotation) => {
    const projection = projectionByRotationId.get(rotation.id);
    return (
      projection !== undefined &&
      (projection.predictedBoardingAt !== rotation.predicted_boarding_at ||
        projection.predictedDepartureAt !== rotation.predicted_departure_at ||
        projection.predictedLandingAt !== rotation.predicted_landing_at ||
        projection.predictedCompletionAt !== rotation.predicted_completion_at)
    );
  });
  if (!activeTimelineChanged) return null;

  const projectedCompletionByAircraftId = new Map<string, string | null>();
  const projectedCompletionByPilotId = new Map<string, string | null>();
  for (const rotation of activeRotations) {
    const projection = projectionByRotationId.get(rotation.id);
    if (!projection) continue;
    if (rotation.aircraft_id) {
      projectedCompletionByAircraftId.set(rotation.aircraft_id, projection.predictedCompletionAt);
    }
    if (rotation.pilot_id) {
      projectedCompletionByPilotId.set(rotation.pilot_id, projection.predictedCompletionAt);
    }
  }

  return {
    ...data,
    rotationRows: {
      ...data.rotationRows,
      results: data.rotationRows.results.map((rotation) => {
        const projection = projectionByRotationId.get(rotation.id);
        return projection && ACTIVE_ROTATION_STATUSES.has(rotation.status)
          ? {
              ...rotation,
              predicted_boarding_at: projection.predictedBoardingAt,
              predicted_departure_at: projection.predictedDepartureAt,
              predicted_landing_at: projection.predictedLandingAt,
              predicted_completion_at: projection.predictedCompletionAt,
            }
          : rotation;
      }),
    },
    capacityRows: {
      ...data.capacityRows,
      results: data.capacityRows.results.map((aircraft) => ({
        ...aircraft,
        predicted_completion_at: projectedCompletionByAircraftId.has(aircraft.aircraft_id)
          ? (projectedCompletionByAircraftId.get(aircraft.aircraft_id) ?? null)
          : aircraft.predicted_completion_at,
      })),
    },
    pilotRows: {
      ...data.pilotRows,
      results: data.pilotRows.results.map((pilot) => ({
        ...pilot,
        predicted_completion_at: projectedCompletionByPilotId.has(pilot.id)
          ? (projectedCompletionByPilotId.get(pilot.id) ?? null)
          : pilot.predicted_completion_at,
      })),
    },
  };
}

export function projectForecastTimelineInput(
  data: ForecastTimelineData,
  eventId: string,
  now = new Date(),
) {
  const {
    event,
    rotationRows,
    durationRows,
    capacityRows,
    turnaroundOverrideRows,
    pilotRows,
    gateWaitRows,
    plannedOperationRows,
    recurringRuleRows,
    activeBlockRows,
    activeDispatchLeaseRows,
  } = data;
  const nowIso = now.toISOString();
  const resolvedPlans = plannedOperationRows.results.flatMap((plan) => {
    const afterRotationAt = plan.completed_at ?? plan.predicted_completion_at;
    const earliest =
      (plan.status === "ACTIVE" ? plan.activated_at : plan.earliest_start_at) ??
      (afterRotationAt ? new Date(Date.parse(afterRotationAt)).toISOString() : null);
    const latest =
      (plan.status === "ACTIVE" ? plan.activated_at : plan.latest_start_at) ??
      (afterRotationAt ? new Date(Date.parse(afterRotationAt) + 5 * 60_000).toISOString() : null);
    if (!earliest || !latest) return [];
    return [
      {
        id: plan.id,
        scopeType: plan.scope_type,
        scopeId: plan.scope_id,
        effectMode: plan.effect_mode,
        durationMultiplierPercent: plan.duration_multiplier_percent,
        active: plan.status === "ACTIVE",
        earliestStartAt: earliest,
        latestStartAt: latest,
        minimumDurationMinutes: plan.minimum_duration_minutes,
        typicalDurationMinutes: plan.typical_duration_minutes,
        maximumDurationMinutes: plan.maximum_duration_minutes,
        overdue:
          plan.status === "ACTIVE"
            ? Date.parse(earliest) + plan.maximum_duration_minutes * 60_000 <= now.getTime()
            : Date.parse(latest) <= now.getTime(),
      },
    ];
  });
  const availablePilotWindows = pilotRows.results.flatMap((pilot) => {
    const immediatelyAvailable = pilot.paused === 0 && pilot.predicted_completion_at === null;
    const expectedReturnAt =
      pilot.paused === 1
        ? pilot.pause_expected_review_at &&
          Math.max(
            Date.parse(pilot.pause_expected_review_at),
            Date.parse(pilot.predicted_completion_at ?? pilot.pause_expected_review_at),
          )
        : pilot.predicted_completion_at;
    const window = availabilityWindow(
      typeof expectedReturnAt === "number"
        ? new Date(expectedReturnAt).toISOString()
        : expectedReturnAt,
      immediatelyAvailable,
      now,
    );
    return window ? [{ pilotId: pilot.id, ...window }] : [];
  });
  const resourceGroupIds = [
    ...new Set([
      ...capacityRows.results.map((row) => row.resource_group_id),
      ...rotationRows.results.map((row) => row.resource_group_id),
    ]),
  ].sort(order);
  type ForecastAircraftWindow = {
    resourceGroupId: string;
    aircraftId: string;
    currentPilotId: string | null;
    passengerSeats: number;
    lowerAt: string;
    expectedAt: string;
    upperAt: string;
    groupBlock: { lowerAt: string; expectedAt: string; upperAt: string } | null | undefined;
  };
  const aircraftWindows = resourceGroupIds.flatMap((resourceGroupId) => {
    const groupBlock = blockedResourceAvailability(
      activeBlockRows.results,
      resourceGroupId,
      eventId,
      now,
    );
    if (groupBlock === null) return [];
    return capacityRows.results
      .filter((row) => row.resource_group_id === resourceGroupId)
      .flatMap((aircraft) => {
        if (aircraft.operational_interrupted === 1 || aircraft.operational_state === "INACTIVE") {
          return [];
        }
        const blocked = ["PAUSED", "REFUELING"].includes(aircraft.operational_state);
        const immediatelyAvailable = aircraft.predicted_completion_at === null && !blocked;
        let expectedReturnAt = aircraft.predicted_completion_at;
        if (blocked) {
          expectedReturnAt = aircraft.expected_review_at
            ? new Date(
                Math.max(
                  Date.parse(aircraft.expected_review_at),
                  Date.parse(aircraft.predicted_completion_at ?? aircraft.expected_review_at),
                ),
              ).toISOString()
            : null;
        }
        const window = availabilityWindow(expectedReturnAt, immediatelyAvailable, now);
        return window
          ? [
              {
                resourceGroupId,
                aircraftId: aircraft.aircraft_id,
                currentPilotId: aircraft.current_pilot_id,
                passengerSeats: aircraft.passenger_seats,
                groupBlock,
                ...window,
              } satisfies ForecastAircraftWindow,
            ]
          : [];
      })
      .sort(
        (left, right) =>
          Date.parse(left.expectedAt) - Date.parse(right.expectedAt) ||
          left.aircraftId.localeCompare(right.aircraftId),
      );
  });
  const orderedPilots = [...availablePilotWindows].sort(
    (left, right) =>
      Date.parse(left.expectedAt) - Date.parse(right.expectedAt) ||
      left.pilotId.localeCompare(right.pilotId),
  );
  const pilotById = new Map(orderedPilots.map((pilot) => [pilot.pilotId, pilot]));
  const usedPilotIds = new Set<string>();
  const pairedAircraftIds = new Set<string>();
  const resourcePairs: Array<{
    aircraft: ForecastAircraftWindow;
    pilot: (typeof orderedPilots)[number];
  }> = [];
  const pair = (
    aircraft: ForecastAircraftWindow,
    pilot: (typeof orderedPilots)[number] | undefined,
  ) => {
    if (!pilot || usedPilotIds.has(pilot.pilotId) || pairedAircraftIds.has(aircraft.aircraftId)) {
      return;
    }
    usedPilotIds.add(pilot.pilotId);
    pairedAircraftIds.add(aircraft.aircraftId);
    resourcePairs.push({ aircraft, pilot });
  };
  for (const aircraft of aircraftWindows
    .filter((entry) => entry.currentPilotId !== null)
    .sort(
      (left, right) =>
        left.resourceGroupId.localeCompare(right.resourceGroupId) ||
        left.aircraftId.localeCompare(right.aircraftId),
    )) {
    pair(aircraft, pilotById.get(aircraft.currentPilotId ?? ""));
  }
  const unpairedPilots = orderedPilots.filter((pilot) => !usedPilotIds.has(pilot.pilotId));
  let nextPilotIndex = 0;
  for (const aircraft of aircraftWindows
    .filter((entry) => !pairedAircraftIds.has(entry.aircraftId))
    .sort(
      (left, right) =>
        Date.parse(left.expectedAt) - Date.parse(right.expectedAt) ||
        left.resourceGroupId.localeCompare(right.resourceGroupId) ||
        left.aircraftId.localeCompare(right.aircraftId),
    )) {
    pair(aircraft, unpairedPilots[nextPilotIndex]);
    nextPilotIndex += 1;
  }
  const forecastCapacities = resourceGroupIds.map((resourceGroupId) => {
    const availabilityLanes = resourcePairs
      .filter(({ aircraft }) => aircraft.resourceGroupId === resourceGroupId)
      .map(({ aircraft, pilot }) => {
        const groupBlock = aircraft.groupBlock;
        const lowerAt = new Date(
          Math.max(
            Date.parse(aircraft.lowerAt),
            Date.parse(pilot.lowerAt),
            groupBlock ? Date.parse(groupBlock.lowerAt) : 0,
          ),
        ).toISOString();
        const expectedAt = new Date(
          Math.max(
            Date.parse(aircraft.expectedAt),
            Date.parse(pilot.expectedAt),
            groupBlock ? Date.parse(groupBlock.expectedAt) : 0,
          ),
        ).toISOString();
        const upperAt = new Date(
          Math.max(
            Date.parse(aircraft.upperAt),
            Date.parse(pilot.upperAt),
            groupBlock ? Date.parse(groupBlock.upperAt) : 0,
          ),
        ).toISOString();
        const constraints = resolvedPlans.filter(
          (plan) =>
            (plan.scopeType === "AIRCRAFT" && plan.scopeId === aircraft.aircraftId) ||
            (plan.scopeType === "PILOT" && plan.scopeId === pilot.pilotId),
        );
        return {
          laneId: `${aircraft.aircraftId}:${pilot.pilotId}`,
          aircraftId: aircraft.aircraftId,
          pilotId: pilot.pilotId,
          passengerSeats: aircraft.passengerSeats,
          availableLowerAt: lowerAt,
          availableExpectedAt: expectedAt,
          availableUpperAt: upperAt,
          constraints,
          recurringConstraints: recurringRuleRows.results
            .filter(
              (rule) =>
                (rule.scope_type === "AIRCRAFT" && rule.scope_id === aircraft.aircraftId) ||
                (rule.scope_type === "PILOT" && rule.scope_id === pilot.pilotId),
            )
            .map((rule) => ({
              id: rule.id,
              triggerMetric: rule.trigger_metric,
              intervalValue: rule.interval_value,
              progressValue: rule.progress_value,
              minimumDurationMinutes: rule.minimum_duration_minutes,
              typicalDurationMinutes: rule.typical_duration_minutes,
              maximumDurationMinutes: rule.maximum_duration_minutes,
              active: true,
            })),
        };
      });
    const groupReturnUnknown = activeBlockRows.results.some(
      (block) =>
        block.expected_review_at === null &&
        ((block.scope_type === "EVENT" && block.scope_id === eventId) ||
          (block.scope_type === "RESOURCE_GROUP" && block.scope_id === resourceGroupId)),
    );
    const aircraftReturnUnknown = capacityRows.results.some(
      (aircraft) =>
        aircraft.resource_group_id === resourceGroupId &&
        (["PAUSED", "REFUELING"].includes(aircraft.operational_state) ||
          aircraft.operational_interrupted === 1) &&
        aircraft.expected_review_at === null,
    );
    const pilotReturnUnknown =
      aircraftWindows.some((aircraft) => aircraft.resourceGroupId === resourceGroupId) &&
      availabilityLanes.length === 0 &&
      pilotRows.results.some(
        (pilot) => pilot.paused === 1 && pilot.pause_expected_review_at === null,
      );
    return {
      resourceGroupId,
      activeAircraft: availabilityLanes.filter(
        (lane) => Date.parse(lane.availableExpectedAt) <= now.getTime(),
      ).length,
      availabilityLanes,
      sharedConstraints: resolvedPlans.filter(
        (plan) =>
          (plan.scopeType === "EVENT" && plan.scopeId === eventId) ||
          (plan.scopeType === "RESOURCE_GROUP" && plan.scopeId === resourceGroupId),
      ),
      unavailableReason:
        availabilityLanes.length === 0 &&
        (groupReturnUnknown || aircraftReturnUnknown || pilotReturnUnknown)
          ? ("UNKNOWN_RESOURCE_RETURN" as const)
          : null,
    };
  });
  const adaptiveLeadMinutes = deriveAdaptivePrecallLeadMinutes({
    observedGateWaitMinutes: [...gateWaitRows.results].reverse().map((row) =>
      normalizePrecallObservation({
        observedGoToGateToBoardingMinutes: row.minutes,
        gateTravelLeadMinutesUsed: row.gate_travel_lead_minutes,
      }),
    ),
  });
  const serviceDeficits = productServiceDeficits(rotationRows.results, now);
  const previousRevision = rotationRows.results.find(
    (rotation) => rotation.status === "DRAFT" && rotation.dispatch_plan_revision !== null,
  )?.dispatch_plan_revision;
  const previousRows = previousRevision
    ? rotationRows.results.filter(
        (rotation) =>
          rotation.status === "DRAFT" && rotation.dispatch_plan_revision === previousRevision,
      )
    : [];
  const previousBatchIds = [
    ...new Set(
      previousRows.flatMap((rotation) =>
        rotation.dispatch_batch_id ? [rotation.dispatch_batch_id] : [],
      ),
    ),
  ];
  const previousDispatchPlan: DispatchPlan | null =
    previousRows.length > 0 && previousBatchIds.length > 0
      ? {
          planId: previousRows[0]?.dispatch_plan_id ?? `legacy-${previousRevision}`,
          revision: previousRevision ?? "",
          batches: previousBatchIds.map((batchId) => {
            const members = previousRows.filter(
              (rotation) => rotation.dispatch_batch_id === batchId,
            );
            const first = members[0];
            if (!first) throw new Error(`Stored dispatch batch ${batchId} has no members.`);
            const expectedBoardingAt = first.predicted_boarding_at ?? nowIso;
            const lowerAt =
              first.prediction_lower_minutes === null
                ? expectedBoardingAt
                : new Date(now.getTime() + first.prediction_lower_minutes * 60_000).toISOString();
            const upperAt =
              first.prediction_upper_minutes === null
                ? expectedBoardingAt
                : new Date(now.getTime() + first.prediction_upper_minutes * 60_000).toISOString();
            return {
              id: batchId,
              resourceGroupId: first.resource_group_id,
              productId: first.product_id ?? `legacy-product:${first.id}`,
              gateId: first.gate_id ?? `legacy-gate:${first.resource_group_id}`,
              laneId: first.dispatch_lane_id ?? "legacy-lane",
              assumedAircraftId:
                first.forecast_assumed_aircraft_id ?? first.aircraft_id ?? "legacy-aircraft",
              assumedPilotId: first.dispatch_lane_id?.split(":")[1] ?? null,
              memberIds: members.map((member) => member.id),
              groupIds: JSON.parse(first.dispatch_group_ids_json) as string[],
              occupiedSeats: first.dispatch_occupied_seats ?? first.ticket_count,
              availableSeats: first.dispatch_available_seats ?? 0,
              dispatchOrder: first.dispatch_order ?? 1,
              wave: first.dispatch_wave ?? 1,
              boardingWindowLowerAt: lowerAt,
              boardingWindowExpectedAt: expectedBoardingAt,
              boardingWindowUpperAt: upperAt,
              predictedCompletionAt: first.predicted_completion_at ?? expectedBoardingAt,
              commitmentLevel: first.dispatch_commitment_level ?? "WAITING",
              decisionReasons: JSON.parse(
                first.dispatch_decision_reasons_json,
              ) as DispatchPlan["batches"][number]["decisionReasons"],
            };
          }),
          groupDecisions: previousRows.flatMap((rotation) =>
            rotation.dispatch_batch_id && rotation.dispatch_lane_id && rotation.dispatch_order
              ? [
                  {
                    memberId: rotation.id,
                    batchId: rotation.dispatch_batch_id,
                    laneId: rotation.dispatch_lane_id,
                    dispatchOrder: rotation.dispatch_order,
                    projectedOvertakeCount: rotation.dispatch_projected_overtake_count,
                    decisionReasons: JSON.parse(
                      rotation.dispatch_decision_reasons_json,
                    ) as DispatchPlan["groupDecisions"][number]["decisionReasons"],
                  },
                ]
              : [],
          ),
          unplannedGroups: previousRows.flatMap((rotation) =>
            rotation.dispatch_unplanned_reason
              ? [
                  {
                    memberId: rotation.id,
                    reason: rotation.dispatch_unplanned_reason,
                  },
                ]
              : [],
          ),
          limits: { ...DEFAULT_DISPATCH_PLANNING_LIMITS },
        }
      : null;
  const draftRotationById = new Map(
    rotationRows.results
      .filter((rotation) => rotation.status === "DRAFT")
      .map((rotation) => [rotation.id, rotation] as const),
  );
  const lockedDispatchBatches: DispatchLockedBatchInput[] = activeDispatchLeaseRows.results.map(
    (lease) => {
      const memberIds = stringArray(lease.member_rotation_ids_json);
      const members = memberIds.flatMap((memberId) => {
        const member = draftRotationById.get(memberId);
        return member ? [member] : [];
      });
      const first = members[0];
      if (!first || members.length !== memberIds.length || !first.product_id || !first.gate_id) {
        throw new Error(`Active dispatch lease ${lease.id} references unavailable members.`);
      }
      return {
        id: lease.dispatch_batch_id,
        resourceGroupId: first.resource_group_id,
        productId: first.product_id,
        gateId: first.gate_id,
        aircraftId: lease.aircraft_id,
        memberIds,
      };
    },
  );
  const dispatchPredecessorsByMember = dispatchPredecessors(rotationRows.results);
  const forecastInput = {
    event: {
      eventId,
      now: nowIso,
      plannedOperationsStartAt: event.operations_start_at,
      plannedOperationsEndAt: event.operations_end_at,
      operationalInterrupted: event.operational_interrupted === 1,
      emergencyMode: event.emergency_mode === 1,
      plannedBoardingMinutes: event.planned_boarding_minutes,
      plannedDeboardingMinutes: event.planned_deboarding_minutes,
      plannedBufferMinutes: event.planned_buffer_minutes,
    },
    capacities: forecastCapacities,
    previousDispatchPlan,
    lockedDispatchBatches,
    durationSamples: durationRows.results.map((row) => ({
      minutes: row.minutes,
      completedAt: row.completed_at,
      eventId: row.operation_day_id,
      productCode: row.product_code,
      aircraftType: row.aircraft_type,
    })),
    rotations: rotationRows.results.map((rotation) => {
      const turnaroundProfiles = turnaroundOverrideRows.results
        .filter((row) => row.product_id === rotation.product_id)
        .map((row) => {
          const resolved = resolveTurnaroundProfile({
            event: {
              sourceId: eventId,
              boardingMinutes: event.planned_boarding_minutes,
              deboardingMinutes: event.planned_deboarding_minutes,
              bufferMinutes: event.planned_buffer_minutes,
            },
            product: {
              sourceId: row.product_id,
              boardingMinutes: row.product_boarding,
              deboardingMinutes: row.product_deboarding,
              bufferMinutes: row.product_buffer,
            },
            aircraftProduct: {
              sourceId: `${row.aircraft_id}:${row.product_id}`,
              boardingMinutes: row.aircraft_boarding,
              deboardingMinutes: row.aircraft_deboarding,
              bufferMinutes: row.aircraft_buffer,
            },
          });
          return {
            aircraftId: row.aircraft_id,
            boardingMinutes: resolved.boarding.valueMinutes,
            deboardingMinutes: resolved.deboarding.valueMinutes,
            bufferMinutes: resolved.buffer.valueMinutes,
            boardingSource: `${resolved.boarding.sourceLevel}:${resolved.boarding.sourceId}`,
            deboardingSource: `${resolved.deboarding.sourceLevel}:${resolved.deboarding.sourceId}`,
            bufferSource: `${resolved.buffer.sourceLevel}:${resolved.buffer.sourceId}`,
          };
        });
      const confirmedTurnaroundProfile =
        rotation.turnaround_boarding_minutes !== null &&
        rotation.turnaround_deboarding_minutes !== null &&
        rotation.turnaround_buffer_minutes !== null
          ? {
              boardingMinutes: rotation.turnaround_boarding_minutes,
              deboardingMinutes: rotation.turnaround_deboarding_minutes,
              bufferMinutes: rotation.turnaround_buffer_minutes,
              boardingSource: rotation.turnaround_boarding_source ?? "LEGACY_UNKNOWN",
              deboardingSource: rotation.turnaround_deboarding_source ?? "LEGACY_UNKNOWN",
              bufferSource: rotation.turnaround_buffer_source ?? "LEGACY_UNKNOWN",
            }
          : null;
      return {
        id: rotation.id,
        status: rotation.status,
        createdAt: rotation.created_at,
        calledAt: rotation.called_at,
        departedAt: rotation.departed_at,
        landedAt: rotation.landed_at,
        resourceGroupId: rotation.resource_group_id,
        aircraftId: rotation.aircraft_id,
        pilotId: rotation.pilot_id,
        resourceGroupStatus: rotation.resource_group_status,
        queueSequence: rotation.queue_sequence,
        dispatchGroupIds: JSON.parse(rotation.current_group_ids_json) as string[],
        dispatchPredecessorMemberIds: [
          ...(dispatchPredecessorsByMember.get(rotation.id) ?? new Set<string>()),
        ],
        productId: rotation.product_id ?? `legacy-product:${rotation.id}`,
        gateId: rotation.gate_id ?? `legacy-gate:${rotation.resource_group_id}`,
        soldAt: rotation.sold_at ?? rotation.created_at,
        attendanceStatus: rotation.attendance_status,
        standby: rotation.standby === 1,
        publicStatus: precallPublicStatus(rotation.precall_decision_status),
        confirmedOvertakeCount: rotation.dispatch_confirmed_overtake_count,
        productServiceDeficit: rotation.product_id
          ? (serviceDeficits.get(rotation.product_id) ?? 0)
          : 0,
        passengerCount: rotation.ticket_count,
        referenceDurationMinutes: rotation.reference_duration_minutes,
        productCode: rotation.product_code,
        aircraftType: rotation.aircraft_type,
        predictedDepartureAt: rotation.predicted_departure_at,
        predictedLandingAt: rotation.predicted_landing_at,
        predictedCompletionAt: rotation.predicted_completion_at,
        turnaroundProfiles,
        confirmedTurnaroundProfile,
        constraints: resolvedPlans.filter(
          (plan) =>
            (plan.scopeType === "EVENT" && plan.scopeId === eventId) ||
            (plan.scopeType === "RESOURCE_GROUP" && plan.scopeId === rotation.resource_group_id) ||
            (plan.scopeType === "AIRCRAFT" && plan.scopeId === rotation.aircraft_id) ||
            (plan.scopeType === "PILOT" && plan.scopeId === rotation.pilot_id),
        ),
      };
    }),
  } satisfies ForecastTimelinesInput;
  return { forecastInput, adaptiveLeadMinutes, now, nowIso };
}
