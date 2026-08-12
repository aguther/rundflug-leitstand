import {
  calculateConfirmedOvertakeIncrements,
  type NonCanceledRotationState,
} from "@rundflug/domain";

import type { SimulationRotation } from "./model";

interface DispatchableSimulationRotation extends SimulationRotation {
  status: NonCanceledRotationState;
}

export function recordConfirmedOvertakes(input: {
  rotations: DispatchableSimulationRotation[];
  selectedRotationIds: readonly string[];
  resourceGroupId?: string;
}): void {
  const waiting = input.rotations
    .filter(
      (rotation) =>
        rotation.status === "DRAFT" &&
        (input.resourceGroupId === undefined || rotation.resourceGroupId === input.resourceGroupId),
    )
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id),
    );
  const queueSequenceByRotationId = new Map(
    waiting.map((rotation, index) => [rotation.id, index + 1] as const),
  );
  const increments = calculateConfirmedOvertakeIncrements({
    selectedMembers: input.selectedRotationIds.flatMap((rotationId) => {
      const queueSequence = queueSequenceByRotationId.get(rotationId);
      return queueSequence === undefined ? [] : [{ rotationId, queueSequence }];
    }),
    waitingMembers: waiting.map((rotation, index) => ({
      rotationId: rotation.id,
      queueSequence: index + 1,
    })),
  });
  for (const entry of increments) {
    const rotation = input.rotations.find((candidate) => candidate.id === entry.rotationId);
    if (rotation) {
      rotation.dispatchConfirmedOvertakeCount =
        (rotation.dispatchConfirmedOvertakeCount ?? 0) + entry.increment;
    }
  }
}
