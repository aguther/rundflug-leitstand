import type { OperationBoard, TicketSearchResult } from "@rundflug/contracts";

export const TICKET_STATUS_REVALIDATION_BATCH_SIZE = 50;

export function ticketGroupIdBatches(ticketGroupIds: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (
    let offset = 0;
    offset < ticketGroupIds.length;
    offset += TICKET_STATUS_REVALIDATION_BATCH_SIZE
  ) {
    batches.push(ticketGroupIds.slice(offset, offset + TICKET_STATUS_REVALIDATION_BATCH_SIZE));
  }
  return batches;
}

export function mergeRevalidatedTicketGroups(
  current: readonly TicketSearchResult[],
  refreshed: readonly TicketSearchResult[],
): TicketSearchResult[] {
  const refreshedById = new Map(refreshed.map((result) => [result.ticketGroupId, result]));
  return current.map((result) => refreshedById.get(result.ticketGroupId) ?? result);
}

export function applyOperationBoardTicketStatuses(
  results: readonly TicketSearchResult[],
  rotations: OperationBoard["rotations"] | undefined,
): TicketSearchResult[] {
  if (!rotations || rotations.length === 0 || results.length === 0) return [...results];

  const statusesByTicketGroupId = new Map<string, Set<string>>();
  for (const rotation of rotations) {
    for (const bookingGroup of rotation.bookingGroups) {
      const statuses = statusesByTicketGroupId.get(bookingGroup.id) ?? new Set<string>();
      statuses.add(rotation.status);
      statusesByTicketGroupId.set(bookingGroup.id, statuses);
    }
  }

  return results.map((result) => {
    const statuses = statusesByTicketGroupId.get(result.ticketGroupId);
    if (!statuses || statuses.size === 0) return result;
    const rotationStatuses = [...statuses].sort();
    const allCompleted = rotationStatuses.every((status) => status === "COMPLETED");
    return {
      ...result,
      groupStatus:
        result.groupStatus === "COMPLETED" || allCompleted ? "COMPLETED" : result.groupStatus,
      rotationStatus: rotationStatuses[0] ?? null,
      rotationStatuses,
    };
  });
}
