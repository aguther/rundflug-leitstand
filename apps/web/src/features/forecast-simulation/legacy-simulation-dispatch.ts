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

interface LegacySimulationDispatchInput {
  config: SimulationConfig;
  nowMs: number;
  operationsAvailable: boolean;
  rotations: RuntimeRotation[];
  aircraft: RuntimeAircraft[];
  previousDispatchPlan: DispatchPlan | null;
  previousDispatchAssignments: Map<string, PreviousDispatchAssignment>;
  dispatchDiagnostics: SimulationDispatchDiagnostics;
  recordEvent: LegacySimulationEventRecorder;
}

function totalPhaseMinutes(config: SimulationConfig, field: "minimum" | "typical" | "maximum") {
  const phases = config.realityModel.phases;
  return (
    phases.boarding[field] + phases.flight[field] + phases.deboarding[field] + phases.buffer[field]
  );
}

function buildDispatchPlan(input: LegacySimulationDispatchInput): DispatchPlan {
  const waiting = input.rotations
    .filter(
      (rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= input.nowMs,
    )
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id),
    );
  return createDispatchPlan({
    now: iso(input.nowMs),
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
    lanes: input.aircraft.flatMap((entry) =>
      entry.state === "AVAILABLE" && entry.activeRotationId === null
        ? [
            {
              id: entry.id,
              aircraftId: entry.id,
              pilotId: null,
              resourceGroupId: RESOURCE_GROUP_ID,
              passengerSeats: entry.capacity,
              availableLowerAt: iso(input.nowMs),
              availableExpectedAt: iso(input.nowMs),
              availableUpperAt: iso(input.nowMs),
              productDurations: [
                {
                  productId: PRODUCT_ID,
                  lowerMinutes: totalPhaseMinutes(input.config, "minimum"),
                  expectedMinutes: totalPhaseMinutes(input.config, "typical"),
                  upperMinutes: totalPhaseMinutes(input.config, "maximum"),
                },
              ],
            },
          ]
        : [],
    ),
    previousPlan: input.previousDispatchPlan,
    limits: SIMULATION_DISPATCH_PLANNING_LIMITS,
  });
}

function recordDispatchPlanChanges(input: LegacySimulationDispatchInput, plan: DispatchPlan) {
  for (const decision of plan.groupDecisions) {
    const batch = plan.batches.find((entry) => entry.id === decision.batchId);
    const rotation = input.rotations.find((entry) => entry.id === decision.memberId);
    if (!batch || !rotation) continue;
    const signature = batch.laneId;
    const previous = input.previousDispatchAssignments.get(decision.memberId);
    const previousLaneStillPlanned =
      previous !== undefined && plan.batches.some((entry) => entry.laneId === previous.signature);
    if (previous && previous.signature !== signature && previousLaneStillPlanned) {
      input.dispatchDiagnostics.unnecessaryPlanChanges += 1;
      if (rotation.precallStatus === "GO_TO_GATE") input.dispatchDiagnostics.goToGateReplans += 1;
    }
    if (previous?.commitment === "PREPARE" && batch.commitmentLevel === "WAITING") {
      input.dispatchDiagnostics.prepareDemotions += 1;
    }
    input.previousDispatchAssignments.set(decision.memberId, {
      signature,
      commitment: batch.commitmentLevel,
    });
  }
}

function activateFirstWaveAssignments(input: LegacySimulationDispatchInput, plan: DispatchPlan) {
  for (const assignment of plan.batches.filter((batch) => batch.wave === 1)) {
    const assignedRotations = assignment.memberIds.flatMap((rotationId) => {
      const rotation = input.rotations.find((candidate) => candidate.id === rotationId);
      return rotation ? [rotation] : [];
    });
    const rotation = assignedRotations[0];
    const entry = input.aircraft.find((candidate) => candidate.id === assignment.assumedAircraftId);
    if (!rotation || !entry || rotation.status !== "DRAFT" || entry.state !== "AVAILABLE") continue;
    recordConfirmedOvertakes({
      rotations: input.rotations,
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
      const index = input.rotations.findIndex((candidate) => candidate.id === merged.id);
      if (index >= 0) input.rotations.splice(index, 1);
    }
    rotation.status = "CALLED";
    rotation.aircraftId = entry.id;
    rotation.calledAt = iso(input.nowMs);
    rotation.boardingMinutes = deterministicSample(
      input.config.seed,
      `${rotation.id}:boarding`,
      input.config.realityModel.phases.boarding,
    );
    rotation.flightMinutes = deterministicSample(
      input.config.seed,
      `${rotation.id}:flight`,
      input.config.realityModel.phases.flight,
    );
    rotation.deboardingMinutes = deterministicSample(
      input.config.seed,
      `${rotation.id}:deboarding`,
      input.config.realityModel.phases.deboarding,
    );
    rotation.bufferMinutes = deterministicSample(
      input.config.seed,
      `${rotation.id}:buffer`,
      input.config.realityModel.phases.buffer,
    );
    entry.state = "ACTIVE";
    entry.activeRotationId = rotation.id;
    input.recordEvent(
      "ROTATION_CALLED",
      input.nowMs,
      entry.id,
      rotation.id,
      `Dispatch-Batch mit ${assignedRotations.length} vollständigen Gruppen und ${assignment.occupiedSeats}/${entry.capacity} Plätzen bestätigt.`,
    );
  }
}

export function dispatchLegacySimulationRotations(
  input: LegacySimulationDispatchInput,
): DispatchPlan | null {
  if (!input.operationsAvailable) return input.previousDispatchPlan;
  const plan = buildDispatchPlan(input);
  recordDispatchPlanChanges(input, plan);
  activateFirstWaveAssignments(input, plan);
  return plan;
}
