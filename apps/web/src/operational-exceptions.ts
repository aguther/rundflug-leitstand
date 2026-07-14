import type { OperationBoard } from "@rundflug/contracts";

type Rotation = OperationBoard["rotations"][number];

export interface OversizeSplitPreview {
  required: boolean;
  slotSizes: number[];
}

export function oversizeSplitPreview(
  groupSize: number,
  referenceCapacity: number,
): OversizeSplitPreview {
  const slotCount = Math.ceil(groupSize / referenceCapacity);
  return {
    required: slotCount > 1,
    slotSizes: Array.from({ length: slotCount }, (_, index) =>
      Math.min(referenceCapacity, groupSize - index * referenceCapacity),
    ),
  };
}

export function sharedGroupSegmentLabel(
  rotation: Rotation,
  rotations: readonly Rotation[],
): string {
  const segments = rotations
    .filter((candidate) => candidate.ticketGroupId === rotation.ticketGroupId)
    .sort(
      (left, right) => left.queuePosition - right.queuePosition || left.id.localeCompare(right.id),
    );
  if (segments.length < 2) return "";
  const position = segments.findIndex((candidate) => candidate.id === rotation.id) + 1;
  return position > 0 ? `Gemeinsame Gruppe ${position}/${segments.length}` : "";
}

export interface MoveTarget {
  rotation: Rotation;
  freeSeats: number;
}

export function eligibleMoveTargets(
  source: Rotation,
  rotations: readonly Rotation[],
): MoveTarget[] {
  const sourceSegments = rotations.filter(
    (candidate) => candidate.ticketGroupId === source.ticketGroupId,
  );
  const sourceIds = new Set(sourceSegments.map((candidate) => candidate.id));
  const groupSize = new Set(
    sourceSegments.flatMap((candidate) => candidate.tickets.map((ticket) => ticket.id)),
  ).size;
  return rotations
    .filter(
      (candidate) =>
        !sourceIds.has(candidate.id) &&
        ["DRAFT", "CALLED"].includes(candidate.status) &&
        candidate.productCode === source.productCode &&
        candidate.usableCapacity - candidate.ticketCount >= groupSize,
    )
    .map((rotation) => ({
      rotation,
      freeSeats: rotation.usableCapacity - rotation.ticketCount,
    }))
    .sort(
      (left, right) =>
        left.rotation.queuePosition - right.rotation.queuePosition ||
        left.rotation.id.localeCompare(right.rotation.id),
    );
}

export function checkedInCount(rotation: Rotation): number {
  return rotation.tickets.filter((ticket) => ticket.attendanceStatus === "CHECKED_IN").length;
}

export function replacementSuggestion(
  target: Rotation,
  rotations: readonly Rotation[],
): MoveTarget | null {
  const freeSeats = target.usableCapacity - target.ticketCount;
  if (freeSeats < 1) return null;
  const seenGroups = new Set<string>();
  for (const rotation of [...rotations].sort(
    (left, right) => left.queuePosition - right.queuePosition || left.id.localeCompare(right.id),
  )) {
    if (
      rotation.ticketGroupId === target.ticketGroupId ||
      seenGroups.has(rotation.ticketGroupId) ||
      !["DRAFT", "CALLED"].includes(rotation.status) ||
      rotation.productCode !== target.productCode
    ) {
      continue;
    }
    seenGroups.add(rotation.ticketGroupId);
    const segments = rotations.filter(
      (candidate) => candidate.ticketGroupId === rotation.ticketGroupId,
    );
    const tickets = segments.flatMap((candidate) => candidate.tickets);
    const uniqueTicketCount = new Set(tickets.map((ticket) => ticket.id)).size;
    if (
      uniqueTicketCount <= freeSeats &&
      tickets.length > 0 &&
      tickets.every((ticket) => ticket.attendanceStatus === "CHECKED_IN")
    ) {
      return { rotation, freeSeats };
    }
  }
  return null;
}
