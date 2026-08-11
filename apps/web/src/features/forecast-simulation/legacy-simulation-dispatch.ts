import { createDispatchPlan, type DispatchPlan } from "@rundflug/domain";
import { recordConfirmedOvertakes } from "./confirmed-overtakes";
import type { LegacySimulationEventRecorder } from "./legacy-simulation-lifecycle";
import {
  dispatchPublicStatus,
  PRODUCT_ID,
  RESOURCE_GROUP_ID,
  type RuntimeAircraft,
  type RuntimeRotation,
} from "./legacy-simulation-scenario";
import type { SimulationConfig, SimulationDispatchDiagnostics } from "./model";
import { SIMULATION_DISPATCH_PLANNING_LIMITS } from "./model";
import { deterministicSample, toSimulationIso as iso } from "./simulation-primitives";

type PreviousDispatchAssignment = {
  signature: string;
  commitment: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE";
};

export function dispatchLegacySimulationRotations(input: {
  config: SimulationConfig;
  nowMs: number;
  operationsAvailable: boolean;
  rotations: RuntimeRotation[];
  aircraft: RuntimeAircraft[];
  previousDispatchPlan: DispatchPlan | null;
  previousDispatchAssignments: Map<string, PreviousDispatchAssignment>;
  dispatchDiagnostics: SimulationDispatchDiagnostics;
  recordEvent: LegacySimulationEventRecorder;
}): DispatchPlan | null {
  const {
    config,
    nowMs,
    operationsAvailable,
    rotations,
    aircraft,
    previousDispatchAssignments,
    dispatchDiagnostics,
    recordEvent,
  } = input;
  let { previousDispatchPlan } = input;
  if (operationsAvailable) {
    const waiting = rotations
      .filter((rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= nowMs)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    const plan = createDispatchPlan({
      now: iso(nowMs),
      groups: waiting.map((rotation, index) => ({
        id: rotation.id,
        groupIds: [rotation.id],
        size: rotation.passengerCount,
        queueSequence: index + 1,
        productId: PRODUCT_ID,
        resourceGroupId: RESOURCE_GROUP_ID,
        gateId: "SIMULATION_GATE",
        soldAt: rotation.createdAt,
        attendanceStatus: "WAITING" as const,
        standby: false,
        publicStatus: dispatchPublicStatus(rotation),
        confirmedOvertakeCount: rotation.dispatchConfirmedOvertakeCount ?? 0,
      })),
      lanes: aircraft.flatMap((entry) =>
        entry.state === "AVAILABLE" && entry.activeRotationId === null
          ? [
              {
                id: entry.id,
                aircraftId: entry.id,
                pilotId: null,
                resourceGroupId: RESOURCE_GROUP_ID,
                passengerSeats: entry.capacity,
                availableLowerAt: iso(nowMs),
                availableExpectedAt: iso(nowMs),
                availableUpperAt: iso(nowMs),
                productDurations: [
                  {
                    productId: PRODUCT_ID,
                    lowerMinutes:
                      config.realityModel.phases.boarding.minimum +
                      config.realityModel.phases.flight.minimum +
                      config.realityModel.phases.deboarding.minimum +
                      config.realityModel.phases.buffer.minimum,
                    expectedMinutes:
                      config.realityModel.phases.boarding.typical +
                      config.realityModel.phases.flight.typical +
                      config.realityModel.phases.deboarding.typical +
                      config.realityModel.phases.buffer.typical,
                    upperMinutes:
                      config.realityModel.phases.boarding.maximum +
                      config.realityModel.phases.flight.maximum +
                      config.realityModel.phases.deboarding.maximum +
                      config.realityModel.phases.buffer.maximum,
                  },
                ],
              },
            ]
          : [],
      ),
      previousPlan: previousDispatchPlan,
      limits: SIMULATION_DISPATCH_PLANNING_LIMITS,
    });
    for (const decision of plan.groupDecisions) {
      const batch = plan.batches.find((entry) => entry.id === decision.batchId);
      const rotation = rotations.find((entry) => entry.id === decision.memberId);
      if (!batch || !rotation) continue;
      const signature = batch.laneId;
      const previous = previousDispatchAssignments.get(decision.memberId);
      const previousLaneStillPlanned =
        previous !== undefined && plan.batches.some((entry) => entry.laneId === previous.signature);
      if (previous && previous.signature !== signature && previousLaneStillPlanned) {
        dispatchDiagnostics.unnecessaryPlanChanges += 1;
        if (rotation.precallStatus === "GO_TO_GATE") {
          dispatchDiagnostics.goToGateReplans += 1;
        }
      }
      if (previous?.commitment === "PREPARE" && batch.commitmentLevel === "WAITING") {
        dispatchDiagnostics.prepareDemotions += 1;
      }
      previousDispatchAssignments.set(decision.memberId, {
        signature,
        commitment: batch.commitmentLevel,
      });
    }
    previousDispatchPlan = plan;
    for (const assignment of plan.batches.filter((batch) => batch.wave === 1)) {
      const assignedRotations = assignment.memberIds.flatMap((rotationId) => {
        const rotation = rotations.find((candidate) => candidate.id === rotationId);
        return rotation ? [rotation] : [];
      });
      const rotation = assignedRotations[0];
      const entry = aircraft.find((candidate) => candidate.id === assignment.assumedAircraftId);
      if (!rotation || !entry || rotation.status !== "DRAFT" || entry.state !== "AVAILABLE")
        continue;
      recordConfirmedOvertakes({
        rotations,
        selectedRotationIds: assignment.memberIds,
        resourceGroupId: RESOURCE_GROUP_ID,
      });
      rotation.passengerCount = assignedRotations.reduce(
        (sum, member) => sum + member.passengerCount,
        0,
      );
      rotation.createdAt = assignedRotations.reduce(
        (earliest, member) =>
          Date.parse(member.createdAt) < Date.parse(earliest) ? member.createdAt : earliest,
        rotation.createdAt,
      );
      rotation.dispatchBatchId = assignment.id;
      rotation.dispatchOrder = assignment.dispatchOrder;
      rotation.dispatchGroupCount = assignedRotations.length;
      rotation.dispatchCapacity = entry.capacity;
      rotation.dispatchOvertakeCount = plan.groupDecisions
        .filter((decision) => assignment.memberIds.includes(decision.memberId))
        .reduce((sum, decision) => sum + decision.projectedOvertakeCount, 0);
      rotation.dispatchMaximumOvertakeCount = Math.max(
        0,
        ...plan.groupDecisions
          .filter((decision) => assignment.memberIds.includes(decision.memberId))
          .map((decision) => decision.projectedOvertakeCount),
      );
      for (const merged of assignedRotations.slice(1)) {
        const index = rotations.findIndex((candidate) => candidate.id === merged.id);
        if (index >= 0) rotations.splice(index, 1);
      }
      rotation.status = "CALLED";
      rotation.aircraftId = entry.id;
      rotation.calledAt = iso(nowMs);
      rotation.boardingMinutes = deterministicSample(
        config.seed,
        `${rotation.id}:boarding`,
        config.realityModel.phases.boarding,
      );
      rotation.flightMinutes = deterministicSample(
        config.seed,
        `${rotation.id}:flight`,
        config.realityModel.phases.flight,
      );
      rotation.deboardingMinutes = deterministicSample(
        config.seed,
        `${rotation.id}:deboarding`,
        config.realityModel.phases.deboarding,
      );
      rotation.bufferMinutes = deterministicSample(
        config.seed,
        `${rotation.id}:buffer`,
        config.realityModel.phases.buffer,
      );
      entry.state = "ACTIVE";
      entry.activeRotationId = rotation.id;
      recordEvent(
        "ROTATION_CALLED",
        nowMs,
        entry.id,
        rotation.id,
        `Dispatch-Batch mit ${assignedRotations.length} vollständigen Gruppen und ${assignment.occupiedSeats}/${entry.capacity} Plätzen bestätigt.`,
      );
    }
  }
  return previousDispatchPlan;
}
