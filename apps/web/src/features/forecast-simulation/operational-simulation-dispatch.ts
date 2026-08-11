import { createDispatchPlan, type DispatchPlan } from "@rundflug/domain";
import { recordConfirmedOvertakes } from "./confirmed-overtakes";
import type { SimulationConfig, SimulationDispatchDiagnostics } from "./model";
import { SIMULATION_DISPATCH_PLANNING_LIMITS } from "./model";
import {
  dispatchPublicStatus,
  type OperationalAircraft,
  type OperationalPilot,
  type OperationalRotation,
  type OperationalSimulationEventRecorder,
} from "./operational-simulation-scenario";
import { deterministicSample, toSimulationIso as iso } from "./simulation-primitives";

export interface OperationalDispatchAssignment {
  signature: string;
  commitment: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE";
}

export function dispatchOperationalSimulationRotations(input: {
  config: SimulationConfig;
  nowMs: number;
  rotations: OperationalRotation[];
  aircraft: OperationalAircraft[];
  pilots: OperationalPilot[];
  previousDispatchPlans: Map<string, DispatchPlan>;
  previousDispatchAssignments: Map<string, OperationalDispatchAssignment>;
  dispatchDiagnostics: SimulationDispatchDiagnostics;
  groupAvailable: (groupId: string, nowMs: number) => boolean;
  pilotAvailable: (pilot: OperationalPilot, nowMs: number) => boolean;
  aircraftAvailable: (aircraft: OperationalAircraft, nowMs: number) => boolean;
  activeSlowdownPercent: (rotation: OperationalRotation, nowMs: number) => number;
  applySlowdownToRemainingPhases: (
    rotation: OperationalRotation,
    targetMultiplierPercent: number,
  ) => void;
  recordEvent: OperationalSimulationEventRecorder;
}): void {
  const {
    config,
    nowMs,
    rotations,
    aircraft,
    pilots,
    previousDispatchPlans,
    previousDispatchAssignments,
    dispatchDiagnostics,
    groupAvailable,
    pilotAvailable,
    aircraftAvailable,
    activeSlowdownPercent,
    applySlowdownToRemainingPhases,
    recordEvent,
  } = input;
  const model = config.operationalModel;
  if (!model) return;
  const freePilots = pilots
    .filter((pilot) => pilotAvailable(pilot, nowMs))
    .sort((left, right) => left.operationalCode.localeCompare(right.operationalCode));
  for (const group of model.resourceGroups) {
    if (!groupAvailable(group.id, nowMs) || freePilots.length === 0) continue;
    const waitingForGroup = rotations
      .filter(
        (rotation) =>
          rotation.status === "DRAFT" &&
          rotation.resourceGroupId === group.id &&
          Date.parse(rotation.createdAt) <= nowMs,
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    const availableAircraft = aircraft.filter(
      (entry) => entry.resourceGroupId === group.id && aircraftAvailable(entry, nowMs),
    );
    const pairedLanes = availableAircraft.flatMap((entry, index) => {
      const pilot = freePilots[index];
      if (!pilot) return [];
      return [
        {
          id: `${entry.id}:${pilot.id}`,
          aircraftId: entry.id,
          pilotId: pilot.id,
          resourceGroupId: group.id,
          passengerSeats: entry.capacity,
          availableLowerAt: iso(nowMs),
          availableExpectedAt: iso(nowMs),
          availableUpperAt: iso(nowMs),
          productDurations: model.products
            .filter((product) => product.resourceGroupId === group.id)
            .map((product) => ({
              productId: product.id,
              lowerMinutes:
                config.realityModel.phases.boarding.minimum +
                product.referenceDurationMinutes +
                config.realityModel.phases.deboarding.minimum +
                config.realityModel.phases.buffer.minimum,
              expectedMinutes:
                config.realityModel.phases.boarding.typical +
                product.referenceDurationMinutes +
                config.realityModel.phases.deboarding.typical +
                config.realityModel.phases.buffer.typical,
              upperMinutes:
                config.realityModel.phases.boarding.maximum +
                product.referenceDurationMinutes +
                config.realityModel.phases.deboarding.maximum +
                config.realityModel.phases.buffer.maximum,
            })),
        },
      ];
    });
    const plan = createDispatchPlan({
      now: iso(nowMs),
      groups: waitingForGroup.map((rotation, index) => ({
        id: rotation.id,
        groupIds: [rotation.id],
        size: rotation.passengerCount,
        queueSequence: index + 1,
        productId: rotation.productId ?? "",
        resourceGroupId: group.id,
        gateId:
          model.products.find((product) => product.id === rotation.productId)?.gateId ??
          group.gateId,
        soldAt: rotation.createdAt,
        attendanceStatus: "WAITING" as const,
        standby: false,
        publicStatus: dispatchPublicStatus(rotation),
        confirmedOvertakeCount: rotation.dispatchConfirmedOvertakeCount ?? 0,
      })),
      lanes: pairedLanes,
      previousPlan: previousDispatchPlans.get(group.id) ?? null,
      limits: SIMULATION_DISPATCH_PLANNING_LIMITS,
    });
    updateDispatchDiagnostics({
      plan,
      rotations,
      previousDispatchAssignments,
      dispatchDiagnostics,
    });
    previousDispatchPlans.set(group.id, plan);
    for (const assignment of dispatchableBatches(plan, rotations)) {
      const pilotIndex = freePilots.findIndex(
        (candidate) => candidate.id === assignment.assumedPilotId,
      );
      const pilot = pilotIndex >= 0 ? freePilots.splice(pilotIndex, 1)[0] : undefined;
      const assignedRotations = assignment.memberIds.flatMap((rotationId) => {
        const rotation = rotations.find((entry) => entry.id === rotationId);
        return rotation ? [rotation] : [];
      });
      const rotation = assignedRotations[0];
      const entry = aircraft.find((candidate) => candidate.id === assignment.assumedAircraftId);
      if (!pilot || !rotation || !entry || !aircraftAvailable(entry, nowMs)) break;
      recordConfirmedOvertakes({
        rotations,
        selectedRotationIds: assignment.memberIds,
        resourceGroupId: group.id,
      });
      mergeAssignedRotations(
        rotation,
        assignedRotations,
        rotations,
        assignment,
        plan,
        entry.capacity,
      );
      rotation.status = "CALLED";
      rotation.aircraftId = entry.id;
      rotation.pilotId = pilot.id;
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
      applySlowdownToRemainingPhases(rotation, activeSlowdownPercent(rotation, nowMs));
      entry.state = "ACTIVE";
      entry.activeRotationId = rotation.id;
      pilot.activeRotationId = rotation.id;
      recordEvent("ROTATION_CALLED", nowMs, {
        aircraftId: entry.id,
        pilotId: pilot.id,
        rotationId: rotation.id,
        details: `Dispatch-Batch mit ${assignedRotations.length} vollständigen Gruppen · ${assignment.occupiedSeats}/${entry.capacity} Plätze · ${rotation.productCode ?? "Produkt"} · ${group.shortCode} · ${pilot.operationalCode}.`,
      });
    }
  }
}

function updateDispatchDiagnostics(input: {
  plan: DispatchPlan;
  rotations: readonly OperationalRotation[];
  previousDispatchAssignments: Map<string, OperationalDispatchAssignment>;
  dispatchDiagnostics: SimulationDispatchDiagnostics;
}): void {
  const { plan, rotations, previousDispatchAssignments, dispatchDiagnostics } = input;
  for (const decision of plan.groupDecisions) {
    const batch = plan.batches.find((entry) => entry.id === decision.batchId);
    const rotation = rotations.find((entry) => entry.id === decision.memberId);
    if (!batch || !rotation) continue;
    const signature = batch.id;
    const previous = previousDispatchAssignments.get(decision.memberId);
    const previousBatchStillPlanned =
      previous !== undefined && plan.batches.some((entry) => entry.id === previous.signature);
    if (previous && previous.signature !== signature && previousBatchStillPlanned) {
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
}

function dispatchableBatches(plan: DispatchPlan, rotations: readonly OperationalRotation[]) {
  return plan.batches.filter(
    (batch) =>
      batch.wave === 1 &&
      batch.memberIds.every((memberId) => {
        const member = rotations.find((rotation) => rotation.id === memberId);
        return member !== undefined && dispatchPublicStatus(member) === "COME_TO_FLIGHT_LINE";
      }),
  );
}

function mergeAssignedRotations(
  rotation: OperationalRotation,
  assignedRotations: OperationalRotation[],
  rotations: OperationalRotation[],
  assignment: DispatchPlan["batches"][number],
  plan: DispatchPlan,
  aircraftCapacity: number,
): void {
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
  rotation.dispatchCapacity = aircraftCapacity;
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
}
